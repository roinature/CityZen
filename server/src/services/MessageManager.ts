import { MessageService } from '../services/MessageService.js';
import type { GameMessage, MessageContext } from '@cityzen/shared';
import type { CityState, WorldState } from '@cityzen/shared';
import type { PrismaClient } from '../generated/prisma/index.js';

export class MessageManager {
  private messageService: MessageService;
  private prisma: PrismaClient;
  private cityStates: Map<string, CityState> = new Map();
  private previousStates: Map<string, MessageContext> = new Map();

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.messageService = new MessageService();
  }

  // Store city state for message generation
  updateCityState(cityId: string, cityState: CityState): void {
    this.cityStates.set(cityId, cityState);
  }

  // Generate and store messages based on game state changes
  async processCityUpdate(cityId: string, cityState: CityState, playerId: string, worldState?: WorldState): Promise<GameMessage[]> {
    const context = this.createMessageContext(cityId, cityState, playerId, worldState);
    const messages = this.messageService.generateMessages(context);

    // Store generated messages in database
    const storedMessages: GameMessage[] = [];
    for (const message of messages) {
      try {
        await this.prisma.gameMessage.create({
          data: {
            id: message.id,
            type: message.type,
            category: message.category,
            priority: message.priority,
            title: message.title,
            content: message.content,
            data: message.data || {},
            cityId: message.cityId || null,
            playerId: message.playerId || null,
            createdAt: new Date(message.createdAt),
            expiresAt: message.expiresAt ? new Date(message.expiresAt) : null,
            isRead: message.isRead,
            displayType: message.displayType,
          },
        });
        storedMessages.push(message);
      } catch (error) {
        console.error('Failed to store message:', error);
      }
    }

    // Update previous state for next comparison
    this.previousStates.set(cityId, context);

    return storedMessages;
  }

  // Get messages for a specific player
  async getPlayerMessages(playerId: string, cityId?: string): Promise<GameMessage[]> {
    const whereClause: any = {
      OR: [
        { playerId },
        { playerId: null }, // Messages for all players
      ],
      isRead: false,
    };

    if (cityId) {
      whereClause.OR = whereClause.OR.map((condition: any) => ({
        ...condition,
        cityId: cityId || null,
      }));
    }

    const dbMessages = await this.prisma.gameMessage.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 50, // Limit to recent messages
    });

    return dbMessages.map(this.convertDbMessageToGameMessage);
  }

  // Mark message as read
  async markMessageAsRead(messageId: string, playerId: string): Promise<boolean> {
    try {
      const result = await this.prisma.gameMessage.updateMany({
        where: {
          id: messageId,
          OR: [
            { playerId },
            { playerId: null },
          ],
        },
        data: { isRead: true },
      });

      return result.count > 0;
    } catch (error) {
      console.error('Failed to mark message as read:', error);
      return false;
    }
  }

  // Clean up old expired messages
  async cleanupExpiredMessages(): Promise<void> {
    try {
      const result = await this.prisma.gameMessage.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
      console.log(`Cleaned up ${result.count} expired messages`);
    } catch (error) {
      console.error('Failed to cleanup expired messages:', error);
    }
  }

  // Create message context from game state
  private createMessageContext(cityId: string, cityState: CityState, playerId: string, worldState?: WorldState): MessageContext {
    const previousState = this.previousStates.get(cityId);

    return {
      cityId,
      cityName: cityState.name,
      playerId,
      playerName: 'Player', // This would come from player data
      population: Math.floor(cityState.resources.population),
      happiness: cityState.resources.happiness || 50,
      money: cityState.resources.money,
      taxRate: cityState.resources.taxRate || 10,
      gameYear: cityState.clock?.gameYear || 1,
      gameDay: cityState.clock?.gameDay || 1,
      buildings: cityState.buildings || [],
      previousState,
    };
  }

  private convertDbMessageToGameMessage(dbMessage: any): GameMessage {
    return {
      id: dbMessage.id,
      type: dbMessage.type,
      category: dbMessage.category,
      priority: dbMessage.priority,
      title: dbMessage.title,
      content: dbMessage.content,
      data: dbMessage.data,
      cityId: dbMessage.cityId,
      playerId: dbMessage.playerId,
      createdAt: dbMessage.createdAt.getTime(),
      expiresAt: dbMessage.expiresAt?.getTime(),
      isRead: dbMessage.isRead,
      displayType: dbMessage.displayType,
    };
  }

  // Custom message creation for game events
  async createCustomMessage(
    type: string,
    category: string,
    priority: string,
    title: string,
    content: string,
    cityId?: string,
    playerId?: string,
    displayType?: string
  ): Promise<GameMessage | null> {
    const messageId = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      const dbMessage = await this.prisma.gameMessage.create({
        data: {
          id: messageId,
          type,
          category,
          priority,
          title,
          content,
          cityId: cityId || null,
          playerId: playerId || null,
          createdAt: new Date(),
          isRead: false,
          displayType: displayType || 'notification',
        },
      });

      return this.convertDbMessageToGameMessage(dbMessage);
    } catch (error) {
      console.error('Failed to create custom message:', error);
      return null;
    }
  }

  // Get message templates for management
  getTemplates() {
    return this.messageService.getAllTemplates();
  }

  // Update message templates
  updateTemplate(template: any): void {
    this.messageService.addTemplate(template);
  }
}