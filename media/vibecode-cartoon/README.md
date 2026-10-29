# Вайбкодер — мультик (9:16, ~68 сек)

`vibecoder.mp4` — готовый ролик 720×1280.

Пересборка:

```bash
pip install edge-tts numpy pillow
python3 work/gen_audio.py voice   # озвучка (edge-tts) + voice/timeline.json
python3 work/mix.py               # голос + SFX + музыка -> out/mix.wav
python3 work/render.py out/vibecoder.mp4
```

Реплики и тайминги — в `LINES` внутри `work/gen_audio.py`; сцены — `render_world()` в `work/render.py`.
Шрифты Rubik и Russo One (OFL) лежат в `fonts/`.
