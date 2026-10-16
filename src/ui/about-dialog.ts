/**
 * About dialog.
 *
 * Rendered from a descriptor so the product identity lives in one place: the name,
 * version and author shown here come from the same constants the window title and the
 * packaging configuration use.
 */

export interface AboutInfo {
  name: string;
  version: string;
  tagline: string;
  author: string;
  email: string;
  engine: string;
  engineLicence: string;
  description: string;
  licenceNote: string;
  closeLabel: string;
  /** Data URL or blob URL for the application mark, when the pack supplied one. */
  iconUrl: string | null;
  labels: {
    author: string;
    email: string;
    engine: string;
    version: string;
    licence: string;
  };
}

export function showAboutDialog(info: AboutInfo): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal modal-about';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    // ---- header: mark, product name, version, tagline ----
    const header = document.createElement('div');
    header.className = 'about-header';

    const mark = document.createElement('div');
    mark.className = 'about-mark';
    if (info.iconUrl) {
      const img = document.createElement('img');
      img.src = info.iconUrl;
      img.alt = '';
      mark.appendChild(img);
    }
    header.appendChild(mark);

    const identity = document.createElement('div');
    identity.className = 'about-identity';

    const name = document.createElement('div');
    name.className = 'about-name';
    name.textContent = info.name;
    identity.appendChild(name);

    const version = document.createElement('div');
    version.className = 'about-version';
    version.textContent = `v${info.version}`;
    identity.appendChild(version);

    if (info.tagline.length > 0) {
      const tagline = document.createElement('div');
      tagline.className = 'about-tagline';
      tagline.textContent = info.tagline;
      identity.appendChild(tagline);
    }
    header.appendChild(identity);
    box.appendChild(header);

    if (info.description.length > 0) {
      const description = document.createElement('p');
      description.className = 'about-description';
      description.textContent = info.description;
      box.appendChild(description);
    }

    // ---- facts ----
    const grid = document.createElement('dl');
    grid.className = 'about-grid';

    const row = (label: string, value: string, node?: HTMLElement): void => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      if (node) dd.appendChild(node);
      else dd.textContent = value;
      grid.append(dt, dd);
    };

    row(info.labels.author, info.author);

    const link = document.createElement('a');
    link.className = 'about-link';
    link.href = `mailto:${info.email}`;
    link.textContent = info.email;
    // The packaged window must not navigate away from the app.
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (window.desktop) window.open(link.href, '_blank');
      else window.location.href = link.href;
    });
    row(info.labels.email, info.email, link);

    row(info.labels.version, info.version);
    row(info.labels.engine, `${info.engine} · ${info.engineLicence}`);
    box.appendChild(grid);

    if (info.licenceNote.length > 0) {
      const note = document.createElement('p');
      note.className = 'about-note';
      note.textContent = info.licenceNote;
      box.appendChild(note);
    }

    // ---- footer ----
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const spacer = document.createElement('span');
    spacer.className = 'modal-spacer';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn primary modal-confirm';
    confirm.textContent = info.closeLabel;
    footer.append(spacer, confirm);
    box.appendChild(footer);
    overlay.appendChild(box);

    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        finish();
      }
    };

    confirm.addEventListener('click', finish);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish();
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    confirm.focus();
  });
}
