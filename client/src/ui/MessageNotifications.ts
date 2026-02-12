import type { GameMessage, MessageState, MessagePriority } from '@cityzen/shared';

export class MessageNotifications {
  private container: HTMLDivElement;
  private notifications: Map<string, HTMLDivElement> = new Map();
  private maxNotifications: number = 5;
  private notificationLifetime: number = 10000; // 10 seconds

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'message-notifications';
    parent.appendChild(this.container);
  }

  addNotification(message: GameMessage): void {
    // Check if this message already exists (avoid duplicates)
    if (this.notifications.has(message.id)) {
      return;
    }

    const notification = this.createNotificationElement(message);
    this.notifications.set(message.id, notification);
    
    // Add to container
    this.container.appendChild(notification);
    
    // Trigger enter animation
    requestAnimationFrame(() => {
      notification.classList.add('enter');
    });

    // Auto-remove after lifetime
    this.scheduleRemoval(message.id, this.notificationLifetime);

    // Limit number of notifications
    this.enforceNotificationLimit();
  }

  private createNotificationElement(message: GameMessage): HTMLDivElement {
    const notification = document.createElement('div');
    notification.className = `message-notification ${message.category} priority-${message.priority}`;
    notification.innerHTML = `
      <div class="notification-icon">${this.getIconForCategory(message.category)}</div>
      <div class="notification-content">
        <div class="notification-title">${message.title}</div>
        <div class="notification-message">${message.content}</div>
      </div>
      <button class="notification-close">×</button>
    `;

    // Add event listeners
    const closeBtn = notification.querySelector('.notification-close')!;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeNotification(message.id);
    });

    // Click to mark as read and remove
    notification.addEventListener('click', () => {
      this.removeNotification(message.id);
    });

    // Hover to pause auto-removal
    let removeTimeout: number;
    const pauseAutoRemoval = () => {
      if (removeTimeout) {
        clearTimeout(removeTimeout);
      }
    };

    const resumeAutoRemoval = () => {
      removeTimeout = window.setTimeout(() => {
        this.removeNotification(message.id);
      }, 2000); // 2 seconds after mouse leaves
    };

    notification.addEventListener('mouseenter', pauseAutoRemoval);
    notification.addEventListener('mouseleave', resumeAutoRemoval);

    return notification;
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

  private scheduleRemoval(messageId: string, delay: number): void {
    setTimeout(() => {
      this.removeNotification(messageId);
    }, delay);
  }

  removeNotification(messageId: string): void {
    const notification = this.notifications.get(messageId);
    if (!notification) return;

    // Add exit animation
    notification.classList.add('exit');
    
    // Remove after animation
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
      this.notifications.delete(messageId);
    }, 300);
  }

  private enforceNotificationLimit(): void {
    const notificationArray = Array.from(this.notifications.entries());
    
    if (notificationArray.length > this.maxNotifications) {
      // Remove oldest notifications
      const toRemove = notificationArray.slice(0, notificationArray.length - this.maxNotifications);
      toRemove.forEach(([id]) => {
        this.removeNotification(id);
      });
    }
  }

  clearAllNotifications(): void {
    Array.from(this.notifications.keys()).forEach(id => {
      this.removeNotification(id);
    });
  }

  getNotificationCount(): number {
    return this.notifications.size;
  }

  setMaxNotifications(max: number): void {
    this.maxNotifications = max;
    this.enforceNotificationLimit();
  }

  setNotificationLifetime(lifetime: number): void {
    this.notificationLifetime = lifetime;
  }
}