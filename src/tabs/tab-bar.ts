/**
 * Document tab strip.
 *
 * Renders one tab per open session, marks the active one, and reports activation,
 * closing and "open another". It holds no document state itself: the bootstrap owns
 * the sessions and re-renders the strip whenever they change.
 */
export interface TabDescriptor {
  id: string;
  title: string;
  dirty: boolean;
  active: boolean;
  /** Shown as the tab's tooltip; usually the full path. */
  hint?: string;
  closeLabel: string;
}

export interface TabBarOptions {
  onActivate(id: string): void;
  onClose(id: string): void;
  onNew(): void;
  newLabel: string;
}

export class TabBar {
  private readonly host: HTMLElement;
  private readonly options: TabBarOptions;

  constructor(host: HTMLElement, options: TabBarOptions) {
    this.host = host;
    this.options = options;
    this.host.addEventListener('click', this.onClick);
    this.host.addEventListener('auxclick', this.onAuxClick);
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('#tab-new')) {
      this.options.onNew();
      return;
    }
    const tab = target?.closest<HTMLElement>('[data-session-id]');
    if (!tab) return;
    const id = tab.dataset['sessionId'];
    if (!id) return;
    if (target?.closest('[data-action="close"]')) {
      event.stopPropagation();
      this.options.onClose(id);
      return;
    }
    this.options.onActivate(id);
  };

  /** Middle-click closes a tab, as in every other tabbed application. */
  private readonly onAuxClick = (event: MouseEvent): void => {
    if (event.button !== 1) return;
    const tab = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-session-id]');
    const id = tab?.dataset['sessionId'];
    if (id) {
      event.preventDefault();
      this.options.onClose(id);
    }
  };

  render(tabs: TabDescriptor[]): void {
    this.host.replaceChildren();
    this.host.classList.toggle('hidden', tabs.length === 0);

    for (const tab of tabs) {
      const node = document.createElement('div');
      node.className = `doc-tab${tab.active ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`;
      node.dataset['sessionId'] = tab.id;
      if (tab.hint) node.title = tab.hint;
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(tab.active));

      const label = document.createElement('span');
      label.className = 'doc-tab-label';
      label.textContent = tab.title;
      node.appendChild(label);

      if (tab.dirty) {
        const dot = document.createElement('span');
        dot.className = 'doc-tab-dot';
        dot.textContent = '•';
        node.appendChild(dot);
      }

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'doc-tab-close';
      close.dataset['action'] = 'close';
      close.textContent = '✕';
      close.title = tab.closeLabel;
      node.appendChild(close);

      this.host.appendChild(node);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.id = 'tab-new';
    add.className = 'doc-tab-new';
    add.textContent = '+';
    add.title = this.options.newLabel;
    this.host.appendChild(add);
  }
}
