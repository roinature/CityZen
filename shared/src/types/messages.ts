export interface GameMessage {
  id: string;
  type: MessageType;
  category: MessageCategory;
  priority: MessagePriority;
  title: string;
  content: string;
  data?: any; // Additional contextual data
  cityId?: string;
  playerId?: string;
  createdAt: number;
  expiresAt?: number;
  isRead: boolean;
  displayType: DisplayType;
}

export enum MessageType {
  // Economic messages
  LOW_FUNDS = 'low_funds',
  BUDGET_SURPLUS = 'budget_surplus',
  BUDGET_DEFICIT = 'budget_deficit',
  TAX_REVENUE = 'tax_revenue',
  
  // Population messages
  POPULATION_MILESTONE = 'population_milestone',
  POPULATION_DECLINE = 'population_decline',
  NEW_CITIZENS = 'new_citizens',
  
  // Happiness messages
  HAPPINESS_HIGH = 'happiness_high',
  HAPPINESS_LOW = 'happiness_low',
  CIVIL_UNREST = 'civil_unrest',
  
  // Development messages
  ZONE_DEVELOPED = 'zone_developed',
  BUILDING_COMPLETED = 'building_completed',
  INFRASTRUCTURE_NEEDED = 'infrastructure_needed',
  
  // Achievement messages
  FIRST_CITY = 'first_city',
  MILESTONE_CITY = 'milestone_city',
  ECONOMIC_BOOM = 'economic_boom',
  
  // System messages
  SYSTEM_ALERT = 'system_alert',
  GAME_EVENT = 'game_event',
  ANNOUNCEMENT = 'announcement',
}

export enum MessageCategory {
  ECONOMY = 'economy',
  POPULATION = 'population',
  HAPPINESS = 'happiness',
  DEVELOPMENT = 'development',
  ACHIEVEMENT = 'achievement',
  SYSTEM = 'system',
}

export enum MessagePriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum DisplayType {
  BANNER = 'banner',        // Top banner dropdown
  NOTIFICATION = 'notification', // Side notifications
  BOTH = 'both',           // Both banner and notification
}

// Dynamic message templates based on game state
export interface MessageTemplate {
  type: MessageType;
  category: MessageCategory;
  priority: MessagePriority;
  displayType: DisplayType;
  titleTemplate: string;     // Template with variables like {cityName}
  contentTemplate: string;    // Template with variables like {population}
  conditions: MessageCondition[];
  cooldownMs?: number;        // Minimum time between same message type
}

export interface MessageCondition {
  field: string;             // e.g., 'population', 'happiness', 'money'
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  value: number;
  // Optional percentage of city population that must meet this condition
  populationThreshold?: number; 
}

// Message generation context
export interface MessageContext {
  cityId: string;
  cityName: string;
  playerId: string;
  playerName: string;
  population: number;
  happiness: number;
  money: number;
  taxRate: number;
  gameYear: number;
  gameDay: number;
  buildings: any[];
  previousState?: Partial<MessageContext>; // For detecting changes
}

// Client-side UI state
export interface MessageState {
  messages: GameMessage[];
  activeBanner: GameMessage | null;
  notifications: GameMessage[];
  unreadCount: number;
}