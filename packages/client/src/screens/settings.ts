// Settings (lib/settings.ts, PWA-003): sound, vibration and default speed. Stored on this device only.
import type { App, Screen } from '../app.ts';
import { t } from '../i18n.ts';
import { button, el, header, screen } from '../ui/dom.ts';
import { APP_VERSION } from '../version.ts';
import { menuScreen } from './menu.ts';

export function settingsScreen(app: App): Screen {
  const box = el('div', { class: 'settings' });

  function draw(): void {
    const s = app.settings;
    const toggle = (label: string, on: boolean, onChange: () => void): HTMLElement =>
      el('div', { class: 'row' }, el('span', {}, label), button(on ? t('settings.on') : t('settings.off'), onChange, { pressed: on }));
    box.replaceChildren(
      toggle(t('settings.sound'), s.sound, () => {
        app.setSettings({ ...app.settings, sound: !app.settings.sound });
        draw();
      }),
      el('p', { class: 'muted small' }, t('settings.sound.note')),
      toggle(t('settings.vibration'), s.vibration, () => {
        app.setSettings({ ...app.settings, vibration: !app.settings.vibration });
        draw();
      }),
      el('h2', { class: 'section' }, t('settings.speed')),
      el(
        'div',
        { class: 'segmented' },
        button('x1', () => {
          app.setSettings({ ...app.settings, speed: 1 });
          draw();
        }, { pressed: s.speed === 1 }),
        button('x2', () => {
          app.setSettings({ ...app.settings, speed: 2 });
          draw();
        }, { pressed: s.speed === 2 }),
      ),
      el('p', { class: 'muted small' }, t('settings.account')),
      el('p', { class: 'muted small' }, t('app.version', { version: APP_VERSION })),
    );
  }

  draw();
  return {
    el: screen(header(t('settings.title'), button(t('app.back'), () => app.go(menuScreen), { className: 'btn-small' })), box),
    onBack: () => app.go(menuScreen),
  };
}
