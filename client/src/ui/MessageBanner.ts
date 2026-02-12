import type { GameMessage, MessageState, MessagePriority } from '@cityzen/shared';

export class MessageBanner {
  private banner: HTMLDivElement;
  private isActive: boolean = false;
  private currentMessage: GameMessage | null = null;
  private hideTimeout: number | null = null;

  constructor(parent: HTMLElement) {
    this.banner = document.createElement('div');
    this.banner.className = 'message-banner';
    this.banner.innerHTML = `
      <div class="message-banner-content">
        <div class="message-banner-icon" id="banner-icon"></div>
        <div class="message-banner-text">
          <div class="message-banner-title" id="banner-title"></div>
          <div class="message-banner-message" id="banner-message"></div>
        </div>
        <button class="message-banner-close" id="banner-close">×</button>
      </div>
    `;
    
    parent.appendChild(this.banner);
    this.setupEventListeners();
    this.hide(); // Initially hidden
  }

  private setupEventListeners(): void {
    const closeBtn = this.banner.querySelector('#banner-close')!;
    closeBtn.addEventListener('click', () => this.hide());
    
    // Auto-hide on banner click (except on close button)
    this.banner.addEventListener('click', (e) => {
      if (e.target !== closeBtn) {
        this.hide();
      }
    });
  }

  showMessage(message: GameMessage): void {
    this.currentMessage = message;
    this.updateBannerContent(message);
    this.show();
    
    // Auto-hide after appropriate time based on priority
    const autoHideDelay = this.getAutoHideDelay(message.priority);
    this.scheduleHide(autoHideDelay);
  }

  private updateBannerContent(message: GameMessage): void {
    const iconElement = this.banner.querySelector('#banner-icon')!;
    const titleElement = this.banner.querySelector('#banner-title')!;
    const messageElement = this.banner.querySelector('#banner-message')!;

    // Update icon based on category
    iconElement.className = `message-banner-icon ${message.category}`;
    iconElement.textContent = this.getIconForCategory(message.category);

    // Update text content
    titleElement.textContent = message.title;
    messageElement.textContent = message.content;

    // Update banner style based on priority
    this.banner.className = `message-banner active priority-${message.priority} category-${message.category}`;
  }

  private getIconForCategory(category: string): string {
    const icons = {
      economy: '💰',
      population: '👥',
      happiness: '😊',
      development: '🏗️',
      achievement: '🏆',
      system: '⚙️'
    };
    return icons[category as keyof typeof icons] || '📢';
  }

  private getAutoHideDelay(priority: MessagePriority): number {
    const delays = {
      low: 5000,      // 5 seconds
      medium: 8000,   // 8 seconds
      high: 12000,    // 12 seconds
      critical: 15000 // 15 seconds
    };
    return delays[priority] || 8000;
  }

  private scheduleHide(delay: number): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    
    this.hideTimeout = window.setTimeout(() => {
      this.hide();
    }, delay);
  }

  show(): void {
    this.isActive = true;
    this.banner.style.display = 'block';
    // Trigger animation
    requestAnimationFrame(() => {
      this.banner.classList.add('active');
    });
  }

  hide(): void {
    this.isActive = false;
    this.banner.classList.remove('active');
    
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    
    // Hide after animation completes
    setTimeout(() => {
      if (!this.isActive) {
        this.banner.style.display = 'none';
      }
    }, 300);
  }

  isActiveBanner(): boolean {
    return this.isActive;
  }

  getCurrentMessage(): GameMessage | null {
    return this.currentMessage;
  }
}