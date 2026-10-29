import asyncio, json, ssl, subprocess, sys, os
import numpy as np
import edge_tts, edge_tts.communicate as c

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
c._SSL_CTX = ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')

VOICES = {
    'V': dict(voice='ru-RU-DmitryNeural', rate='+12%', pitch='-6Hz'),    # вайбкодер Гена
    'K': dict(voice='ru-RU-SvetlanaNeural', rate='+10%', pitch='+0Hz'),  # заказчица
    'AI': dict(voice='en-US-EmmaMultilingualNeural', rate='+8%', pitch='+12Hz'),  # нейросеть
}

# (scene, speaker, text, pause_before)
LINES = [
    ('intro', 'V', 'Писать код руками — это для лохов. Я теперь вайбкодер. Синьор промпт-инженер.', 0.6),
    ('call', 'K', 'Алло, это айти-компания? Нам нужно приложение. Как Озон, только лучше. Сроки — вчера.', 1.6),
    ('call', 'V', 'Изи. За вечер сделаю.', 0.3),
    ('call', 'K', 'А стек какой?', 0.3),
    ('call', 'V', 'Вайб. И энергетик.', 0.3),
    ('prompt', 'V', 'Так. Сделай как Озон. Без багов. Очень важно. Три восклицательных знака — чтоб наверняка.', 0.5),
    ('prompt', 'AI', 'Отличная идея! Вы абсолютно правы! Вот ваш код.', 0.4),
    ('proud', 'V', 'Видали? Даже нейросеть говорит, что я прав.', 0.3),
    ('later', 'K', 'Ну что, где приложение?', 1.6),
    ('later', 'V', 'Так у меня локально всё работает!', 0.3),
    ('fail_k', 'K', 'Почему у нас пропала вся база клиентов?!', 1.0),
    ('fail_screen', 'AI', 'Вы абсолютно правы! Я удалил продакшен базу. Приношу извинения.', 0.4),
    ('final', 'K', 'Чини давай!', 0.4),
    ('final', 'V', 'Не могу. Лимиты кончились. До понедельника.', 0.3),
    ('final2', 'V', 'Вы что, предлагаете код руками писать?! Дикари.', 0.5),
]
SR = 48000


def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    a = np.frombuffer(raw, np.float32).copy()
    # trim silence
    env = np.abs(a) > 0.01
    idx = np.nonzero(env)[0]
    return a[max(0, idx[0] - 800): idx[-1] + 2400]


async def main():
    timeline, t = [], 0.0
    for i, (scene, spk, text, pause) in enumerate(LINES):
        mp3 = f'{OUT}/line{i:02d}.mp3'
        if not os.path.exists(mp3) or os.path.getsize(mp3) == 0:
            for attempt in range(40):
                try:
                    await edge_tts.Communicate(text.replace(' — ', ', '), **VOICES[spk]).save(mp3)
                    break
                except edge_tts.exceptions.NoAudioReceived:
                    print('retry', i, attempt, flush=True)
                    await asyncio.sleep(30)
        a = load(mp3)
        np.save(f'{OUT}/line{i:02d}.npy', a)
        t += pause
        timeline.append(dict(i=i, scene=scene, spk=spk, text=text, start=round(t, 3), dur=round(len(a) / SR, 3)))
        t += len(a) / SR
    json.dump(dict(lines=timeline, total=t + 1.8), open(f'{OUT}/timeline.json', 'w'), ensure_ascii=False, indent=1)
    for l in timeline:
        print(f"{l['start']:6.2f} {l['dur']:5.2f} {l['spk']:2} {l['text']}")
    print('total', t + 1.8)

asyncio.run(main())
