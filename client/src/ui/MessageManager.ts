import type { GameMessage, MessageState, MessagePriority } from '@cityzen/shared';
import { MessageBanner } from './MessageBanner.js';
import { MessageNotifications } from './MessageNotifications.js';

export interface MessageManagerCallbacks {
  onMessageRead?: (messageId: string) => void;
  onMessageClick?: (message: GameMessage) => void;
}

export class MessageManager {
  private banner: MessageBanner;
  private notifications: MessageNotifications;
  private state: MessageState;
  private callbacks: MessageManagerCallbacks;

  constructor(parent: HTMLElement, callbacks: MessageManagerCallbacks = {}) {
    this.callbacks = callbacks;
    this.state = {
      messages: [],
      activeBanner: null,
      notifications: [],
      unreadCount: 0
    };

    // Create UI components
    this.banner = new MessageBanner(parent);
    this.notifications = new MessageNotifications(parent);
  }

  // Add a new message to the system
  addMessage(message: GameMessage): void {
    // Add to state
    this.state.messages.push(message);
    
    // Update unread count
    if (!message.isRead) {
      this.state.unreadCount++;
    }

    // Route to appropriate display
    switch (message.displayType) {
      case 'banner':
        this.showBannerMessage(message);
        break;
      case 'notification':
        this.showNotification(message);
        break;
      case 'both':
        // Show as notification, and banner if no banner is currently active
        this.showNotification(message);
        if (!this.banner.isActiveBanner()) {
          this.showBannerMessage(message);
        }
        break;
    }
  }

  // Add multiple messages at once
  addMessages(messages: GameMessage[]): void {
    // Sort by priority so most important messages are handled first
    const sortedMessages = messages.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });

    sortedMessages.forEach(message => this.addMessage(message));
  }

  private showBannerMessage(message: GameMessage): void {
    this.state.activeBanner = message;
    this.banner.showMessage(message);
  }

  private showNotification(message: GameMessage): void {
    this.state.notifications.push(message);
    this.notifications.addNotification(message);
  }

  // Mark message as read
  markAsRead(messageId: string): void {
    const message = this.state.messages.find(m => m.id === messageId);
    if (message && !message.isRead) {
      message.isRead = true;
      this.state.unreadCount = Math.max(0, this.state.unreadCount - 1);
      this.callbacks.onMessageRead?.(messageId);
    }
  }

  // Get current state
  getState(): MessageState {
    return { ...this.state };
  }

  // Get unread message count
  getUnreadCount(): number {
    return this.state.unreadCount;
  }

  // Get messages by category
  getMessagesByCategory(category: string): GameMessage[] {
    return this.state.messages.filter(m => m.category === category);
  }

  // Get messages by priority
  getMessagesByPriority(priority: MessagePriority): GameMessage[] {
    return this.state.messages.filter(m => m.priority === priority);
  }

  // Clear all messages
  clearAllMessages(): void {
    this.state.messages = [];
    this.state.activeBanner = null;
    this.state.notifications = [];
    this.state.unreadCount = 0;
    
    this.notifications.clearAllNotifications();
    this.banner.hide();
  }

  // Clear messages by category
  clearMessagesByCategory(category: string): void {
    const toRemove = this.state.messages.filter(m => m.category === category);
    toRemove.forEach(message => {
      const index = this.state.messages.indexOf(message);
      if (index > -1) {
        this.state.messages.splice(index, 1);
      }
    });
  }

  // Expire old messages
  expireOldMessages(): void {
    const now = Date.now();
    const validMessages = this.state.messages.filter(m => {
      if (!m.expiresAt) return true; // No expiration date
      return m.expiresAt > now;
    });

    const removedCount = this.state.messages.length - validMessages.length;
    this.state.messages = validMessages;
    this.state.unreadCount = Math.max(0, this.state.unreadCount - removedCount);
  }

  // Configure notification settings
  setMaxNotifications(max: number): void {
    this.notifications.setMaxNotifications(max);
  }

  setNotificationLifetime(lifetime: number): void {
    this.notifications.setNotificationLifetime(lifetime);
  }

  // Handle window focus/blur for message behavior
  handleWindowFocus(): void {
    // When user returns to game, show any pending important messages
    const importantMessages = this.state.messages.filter(
      m => !m.isRead && ['high', 'critical'].includes(m.priority)
    );
    
    if (importantMessages.length > 0 && !this.banner.isActiveBanner()) {
      this.showBannerMessage(importantMessages[0]);
    }
  }

  handleWindowBlur(): void {
    // When user leaves game, pause auto-hiding banners
    // (Implementation depends on specific requirements)
  }
}