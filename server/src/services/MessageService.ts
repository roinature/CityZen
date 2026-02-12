import { MessageType, MessagePriority, MessageCategory, DisplayType } from '@cityzen/shared';
import type { GameMessage, MessageTemplate, MessageContext } from '@cityzen/shared';

export class MessageService {
  private templates: Map<MessageType, MessageTemplate> = new Map();
  private messageCooldowns: Map<string, number> = new Map();

  constructor() {
    this.initializeDefaultTemplates();
  }

  private initializeDefaultTemplates(): void {
    const defaultTemplates: MessageTemplate[] = [
      // Economic messages
      {
        type: MessageType.LOW_FUNDS,
        category: MessageCategory.ECONOMY,
        priority: MessagePriority.HIGH,
        displayType: DisplayType.NOTIFICATION,
        titleTemplate: 'Low Funds Alert',
        contentTemplate: 'Your city treasury is critically low at ${money}! Consider adjusting tax rates or cutting expenses.',
        conditions: [{ field: 'money', operator: 'lt', value: 1000 }],
        cooldownMs: 30000, // 30 seconds
      },
      {
        type: MessageType.BUDGET_SURPLUS,
        category: MessageCategory.ECONOMY,
        priority: MessagePriority.MEDIUM,
        displayType: DisplayType.BANNER,
        titleTemplate: 'Budget Surplus!',
        contentTemplate: 'Excellent! Your city has a budget surplus of ${money} this fiscal period.',
        conditions: [{ field: 'money', operator: 'gt', value: 10000 }],
        cooldownMs: 60000, // 1 minute
      },
      {
        type: MessageType.TAX_REVENUE,
        category: MessageCategory.ECONOMY,
        priority: MessagePriority.LOW,
        displayType: DisplayType.NOTIFICATION,
        titleTemplate: 'Tax Revenue Collected',
        contentTemplate: 'Collected ${taxRevenue} in taxes from ${population} citizens.',
        conditions: [{ field: 'population', operator: 'gt', value: 0 }],
        cooldownMs: 120000, // 2 minutes
      },

      // Population messages
      {
        type: MessageType.POPULATION_MILESTONE,
        category: MessageCategory.POPULATION,
        priority: MessagePriority.MEDIUM,
        displayType: DisplayType.BANNER,
        titleTemplate: 'Population Milestone!',
        contentTemplate: 'Congratulations! ${cityName} has reached ${population} citizens!',
        conditions: [
          { field: 'population', operator: 'gte', value: 100 },
          { field: 'population', operator: 'gte', value: 500 },
          { field: 'population', operator: 'gte', value: 1000 },
          { field: 'population', operator: 'gte', value: 5000 },
        ],
        cooldownMs: 300000, // 5 minutes
      },
      {
        type: MessageType.POPULATION_DECLINE,
        category: MessageCategory.POPULATION,
        priority: MessagePriority.HIGH,
        displayType: DisplayType.NOTIFICATION,
        titleTemplate: 'Population Decline',
        contentTemplate: 'Your population has decreased! Current happiness: ${happiness}%. Check city services.',
        conditions: [{ field: 'happiness', operator: 'lt', value: 30 }],
        cooldownMs: 60000, // 1 minute
      },
      {
        type: MessageType.NEW_CITIZENS,
        category: MessageCategory.POPULATION,
        priority: MessagePriority.LOW,
        displayType: DisplayType.NOTIFICATION,
        titleTemplate: 'New Citizens',
        contentTemplate: '${newCitizens} new citizens have moved to ${cityName}!',
        conditions: [{ field: 'population', operator: 'gt', value: 0 }],
        cooldownMs: 90000, // 1.5 minutes
      },

      // Happiness messages
      {
        type: MessageType.HAPPINESS_HIGH,
        category: MessageCategory.HAPPINESS,
        priority: MessagePriority.MEDIUM,
        displayType: DisplayType.BANNER,
        titleTemplate: 'Happy Citizens!',
        contentTemplate: 'Your citizens are thriving with ${happiness}% happiness in ${cityName}!',
        conditions: [{ field: 'happiness', operator: 'gt', value: 80 }],
        cooldownMs: 240000, // 4 minutes
      },
      {
        type: MessageType.HAPPINESS_LOW,
        category: MessageCategory.HAPPINESS,
        priority: MessagePriority.HIGH,
        displayType: DisplayType.NOTIFICATION,
        titleTemplate: 'Low Happiness Warning',
        contentTemplate: 'Citizen happiness is at ${happiness}%. Consider improving services and infrastructure.',
        conditions: [{ field: 'happiness', operator: 'lt', value: 40 }],
        cooldownMs: 120000, // 2 minutes
      },
      {
        type: MessageType.CIVIL_UNREST,
        category: MessageCategory.HAPPINESS,
        priority: MessagePriority.CRITICAL,
        displayType: DisplayType.BOTH,
        titleTemplate: 'Civil Unrest!',
        contentTemplate: 'Critical: Citizens are protesting! Happiness at ${happiness}%. Immediate action required!',
        conditions: [{ field: 'happiness', operator: 'lt', value: 20 }],
        cooldownMs: 30000, // 30 seconds
      },

      // Development messages
      {
        type: MessageType.ZONE_DEVELOPED,
        category: MessageCategory.DEVELOPMENT,
        priority: MessagePriority.MEDIUM,
        displayType: DisplayType.NOTIFICATION,
        titleTemplate: 'Zone Development',
        contentTemplate: 'A ${buildingType} zone has developed to level ${level} in ${cityName}!',
        conditions: [{ field: 'newDevelopment', operator: 'eq', value: 1 }],
        cooldownMs: 15000, // 15 seconds
      },
      {
        type: MessageType.INFRASTRUCTURE_NEEDED,
        category: MessageCategory.DEVELOPMENT,
        priority: MessagePriority.HIGH,
        displayType: DisplayType.NOTIFICATION,
        titleTemplate: 'Infrastructure Needed',
        contentTemplate: 'Growing population requires more ${infrastructureType}. Build ${neededCount} more to meet demand.',
        conditions: [{ field: 'infrastructureDeficit', operator: 'gt', value: 0 }],
        cooldownMs: 180000, // 3 minutes
      },

      // Achievement messages
      {
        type: MessageType.FIRST_CITY,
        category: MessageCategory.ACHIEVEMENT,
        priority: MessagePriority.MEDIUM,
        displayType: DisplayType.BANNER,
        titleTemplate: 'First City Founded!',
        contentTemplate: 'Welcome to CityZen! ${playerName} has founded ${cityName}. Begin your urban adventure!',
        conditions: [{ field: 'isFirstCity', operator: 'eq', value: 1 }],
        cooldownMs: 0, // Only once
      },
      {
        type: MessageType.ECONOMIC_BOOM,
        category: MessageCategory.ACHIEVEMENT,
        priority: MessagePriority.MEDIUM,
        displayType: DisplayType.BANNER,
        titleTemplate: 'Economic Boom!',
        contentTemplate: 'Your city is experiencing an economic boom! GDP growth and revenue are soaring.',
        conditions: [
          { field: 'money', operator: 'gt', value: 50000 },
          { field: 'happiness', operator: 'gt', value: 70 },
        ],
        cooldownMs: 600000, // 10 minutes
      },
    ];

    defaultTemplates.forEach(template => {
      this.templates.set(template.type, template);
    });
  }

  // Generate messages based on current game state
  generateMessages(context: MessageContext): GameMessage[] {
    const messages: GameMessage[] = [];
    const now = Date.now();

    for (const [messageType, template] of this.templates) {
      if (!this.checkCooldown(messageType, now, template.cooldownMs)) {
        continue;
      }

      if (this.evaluateConditions(template.conditions, context)) {
        const message = this.createMessage(template, context, now);
        if (message) {
          messages.push(message);
          this.setCooldown(messageType, now);
        }
      }
    }

    return messages;
  }

  private evaluateConditions(conditions: any[], context: MessageContext): boolean {
    if (conditions.length === 0) return true;

    // Handle multiple conditions (OR logic - any condition true triggers message)
    return conditions.some(condition => {
      const fieldValue = this.getFieldValue(condition.field, context);
      if (fieldValue === undefined) return false;

      switch (condition.operator) {
        case 'gt': return fieldValue > condition.value;
        case 'lt': return fieldValue < condition.value;
        case 'gte': return fieldValue >= condition.value;
        case 'lte': return fieldValue <= condition.value;
        case 'eq': return fieldValue === condition.value;
        default: return false;
      }
    });
  }

  private getFieldValue(field: string, context: MessageContext): number | undefined {
    switch (field) {
      case 'population': return context.population;
      case 'happiness': return context.happiness;
      case 'money': return context.money;
      case 'taxRate': return context.taxRate;
      case 'gameYear': return context.gameYear;
      case 'gameDay': return context.gameDay;
      case 'isFirstCity': return context.previousState ? 0 : 1;
      case 'newDevelopment': return this.detectNewDevelopment(context);
      case 'infrastructureDeficit': return this.calculateInfrastructureDeficit(context);
      case 'newCitizens': return this.calculateNewCitizens(context);
      case 'taxRevenue': return this.calculateTaxRevenue(context);
      default: return undefined;
    }
  }

  private createMessage(template: MessageTemplate, context: MessageContext, timestamp: number): GameMessage | null {
    try {
      const title = this.interpolateTemplate(template.titleTemplate, context);
      const content = this.interpolateTemplate(template.contentTemplate, context);

      return {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: template.type,
        category: template.category,
        priority: template.priority,
        title,
        content,
        cityId: context.cityId,
        playerId: context.playerId,
        createdAt: timestamp,
        isRead: false,
        displayType: template.displayType,
        data: {
          cityName: context.cityName,
          playerName: context.playerName,
          gameYear: context.gameYear,
          gameDay: context.gameDay,
        }
      };
    } catch (error) {
      console.error('Failed to create message:', error);
      return null;
    }
  }

  private interpolateTemplate(template: string, context: MessageContext): string {
    return template.replace(/\$\{(\w+)\}/g, (match, key) => {
      const value = this.getFieldValue(key, context) || context[key as keyof MessageContext] || '';
      return String(value);
    });
  }

  private checkCooldown(messageType: MessageType, now: number, cooldownMs?: number): boolean {
    if (!cooldownMs) return true;

    const lastSent = this.messageCooldowns.get(messageType);
    if (!lastSent) return true;

    return (now - lastSent) >= cooldownMs;
  }

  private setCooldown(messageType: MessageType, timestamp: number): void {
    this.messageCooldowns.set(messageType, timestamp);
  }

  // Helper methods for complex calculations
  private detectNewDevelopment(context: MessageContext): number {
    if (!context.previousState) return 0;

    const currentBuildings = context.buildings.filter(b => b.developmentLevel > 0).length;
    const previousBuildings = context.previousState.buildings?.filter(b => b.developmentLevel > 0).length || 0;

    return Math.max(0, currentBuildings - previousBuildings);
  }

  private calculateInfrastructureDeficit(context: MessageContext): number {
    // Simplified calculation - in real implementation would check specific infrastructure types
    const powerPlants = context.buildings.filter(b => b.type === 'power_plant').length;
    const waterTowers = context.buildings.filter(b => b.type === 'water_tower').length;

    const population = context.population;
    const requiredPower = Math.ceil(population / 500);
    const requiredWater = Math.ceil(population / 300);

    return Math.max(0, requiredPower - powerPlants) + Math.max(0, requiredWater - waterTowers);
  }

  private calculateNewCitizens(context: MessageContext): number {
    if (!context.previousState) return 0;

    return Math.max(0, context.population - (context.previousState.population || 0));
  }

  private calculateTaxRevenue(context: MessageContext): number {
    // Simplified tax calculation
    return Math.floor(context.population * context.taxRate * 0.5);
  }

  // Template management
  addTemplate(template: MessageTemplate): void {
    this.templates.set(template.type, template);
  }

  removeTemplate(type: MessageType): void {
    this.templates.delete(type);
  }

  getTemplate(type: MessageType): MessageTemplate | undefined {
    return this.templates.get(type);
  }

  getAllTemplates(): MessageTemplate[] {
    return Array.from(this.templates.values());
  }
}