// Loading and notice screens: boot in progress, update required (ERR-010), failure with retry.
import type { App, Screen } from '../app.ts';
import { t } from '../i18n.ts';
import { button, el, screen } from '../ui/dom.ts';

export function loadingScreen(_app: App): Screen {
  return { el: screen(el('p', { class: 'boot' }, t('app.loading'))), isRoot: true };
}

export function noticeScreen(_app: App, title: string, text: string, action: () => void): Screen {
  return {
    el: screen(
      el('div', { class: 'notice' }, el('h1', {}, title), el('p', {}, text), button(t('app.retry'), action, { primary: true })),
    ),
    isRoot: true,
  };
}
