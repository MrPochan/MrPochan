// Small DOM helpers for the menus. No framework; elements are built with explicit attributes and listeners.

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string | boolean | undefined>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export interface ButtonOptions {
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly pressed?: boolean;
  readonly className?: string;
}

/** Button with at least 44 px hit area (UI-008) and a click handler. */
export function button(label: string, onClick: () => void, opts: ButtonOptions = {}): HTMLButtonElement {
  const classes = ['btn'];
  if (opts.primary) classes.push('btn-primary');
  if (opts.className) classes.push(opts.className);
  const b = el(
    'button',
    {
      type: 'button',
      class: classes.join(' '),
      'aria-label': opts.ariaLabel,
      'aria-pressed': opts.pressed === undefined ? undefined : String(opts.pressed),
      disabled: opts.disabled,
    },
    label,
  );
  b.addEventListener('click', () => {
    if (!b.disabled) onClick();
  });
  return b;
}

/** Full screen container. */
export function screen(...children: Child[]): HTMLElement {
  return el('section', { class: 'screen' }, ...children);
}

/** Title row with an optional left action and right actions. */
export function header(title: string, left?: HTMLElement, right: HTMLElement[] = []): HTMLElement {
  return el('header', { class: 'header' }, left ?? el('span', { class: 'header-spacer' }), el('h1', {}, title), el('div', { class: 'header-actions' }, ...right));
}

/** Modal panel above the screen. */
export function dialog(title: string, body: Child[], actions: HTMLElement[]): HTMLElement {
  return el(
    'div',
    { class: 'overlay', role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'dialog' }, el('h2', {}, title), ...body, el('div', { class: 'dialog-actions' }, ...actions)),
  );
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}
