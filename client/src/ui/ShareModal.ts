import { renderQrSvg } from './qrCode.js';

export interface ShareModalCallbacks {
  onCopySuccess: () => void;
  onCopyFallback: (link: string) => void;
}

/** Modal displaying a world invite QR code alongside copy and native share options. */
export class ShareModal {
  private overlay: HTMLDivElement;
  private qrContainer: HTMLDivElement;
  private linkInput: HTMLInputElement;
  private copyBtn: HTMLButtonElement;
  private nativeShareBtn: HTMLButtonElement;
  private currentLink = '';

  constructor(parent: HTMLElement, private callbacks: ShareModalCallbacks) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'share-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <section class="share-panel" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
        <div class="share-header">
          <h2 id="share-modal-title">Invite Friends</h2>
          <button type="button" class="share-close-btn" aria-label="Close">&times;</button>
        </div>
        <p class="share-subtitle">Scan the QR code or share the link so friends can join this Earth world.</p>
        <div class="share-qr-box"></div>
        <div class="share-link-row">
          <input type="text" class="share-link-input" readonly aria-label="World invite link" />
        </div>
        <div class="share-options">
          <button type="button" class="share-option-btn share-copy-btn">Copy Link</button>
          <button type="button" class="share-option-btn share-native-btn" hidden>Share…</button>
        </div>
      </section>
    `;
    parent.appendChild(this.overlay);

    this.qrContainer = this.overlay.querySelector('.share-qr-box')!;
    this.linkInput = this.overlay.querySelector('.share-link-input')!;
    this.copyBtn = this.overlay.querySelector('.share-copy-btn')!;
    this.nativeShareBtn = this.overlay.querySelector('.share-native-btn')!;

    this.overlay.querySelector('.share-close-btn')!.addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    this.linkInput.addEventListener('click', () => {
      this.linkInput.select();
    });

    this.copyBtn.addEventListener('click', () => {
      if (!this.currentLink) return;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(this.currentLink).then(
          () => {
            this.copyBtn.textContent = 'Copied!';
            this.callbacks.onCopySuccess();
            setTimeout(() => {
              this.copyBtn.textContent = 'Copy Link';
            }, 2000);
          },
          () => this.callbacks.onCopyFallback(this.currentLink),
        );
      } else {
        this.callbacks.onCopyFallback(this.currentLink);
      }
    });

    if (typeof navigator.share === 'function') {
      this.nativeShareBtn.hidden = false;
      this.nativeShareBtn.addEventListener('click', () => {
        if (!this.currentLink) return;
        navigator.share({
          title: 'CityZen Earth',
          text: 'Join my Earth world in CityZen to build side by side!',
          url: this.currentLink,
        }).catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'AbortError') return;
          this.callbacks.onCopyFallback(this.currentLink);
        });
      });
    }
  }

  show(link: string): void {
    this.currentLink = link;
    this.linkInput.value = link;
    this.copyBtn.textContent = 'Copy Link';
    try {
      this.qrContainer.innerHTML = renderQrSvg(link);
    } catch {
      this.qrContainer.innerHTML = '<div class="share-qr-error">QR code unavailable for this link length.</div>';
    }
    this.overlay.style.display = 'flex';
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  isVisible(): boolean {
    return this.overlay.style.display !== 'none';
  }
}
