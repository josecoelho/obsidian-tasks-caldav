import { createDAVClient, DAVClient, DAVCalendar, DAVCalendarObject } from 'tsdav';
import { CalDAVSettings } from '../types';
import { VTODOMapper } from './vtodoMapper';

/**
 * Wrapper around tsdav for CalDAV operations
 * Handles authentication, calendar selection, and VTODO CRUD operations
 */
export class CalDAVClient {
  private client: DAVClient | null = null;
  private calendar: DAVCalendar | null = null;
  private settings: CalDAVSettings;
  private mapper: VTODOMapper;

  constructor(settings: CalDAVSettings) {
    this.settings = settings;
    this.mapper = new VTODOMapper();
  }

  /**
   * Connect to CalDAV server and find the specified calendar
   */
  async connect(): Promise<void> {
    try {
      // Create DAV client
      const client = await createDAVClient({
        serverUrl: this.settings.serverUrl,
        credentials: {
          username: this.settings.username,
          password: this.settings.password
        },
        authMethod: 'Basic',
        defaultAccountType: 'caldav'
      });

      // Type guard to ensure we have the right type
      if (!client) {
        throw new Error('Failed to create DAV client');
      }

      this.client = client as any as DAVClient;

      // Fetch calendars
      const calendars = await this.client.fetchCalendars();

      // Find the specified calendar
      this.calendar = calendars.find(
        cal => cal.displayName === this.settings.calendarName
      ) || null;

      if (!this.calendar) {
        throw new Error(`Calendar '${this.settings.calendarName}' not found`);
      }
    } catch (error) {
      console.error('Failed to connect to CalDAV server:', error);
      throw error;
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.client !== null && this.calendar !== null;
  }

  /**
   * Fetch all VTODO objects from the calendar
   */
  async fetchVTODOs(): Promise<DAVCalendarObject[]> {
    if (!this.client || !this.calendar) {
      throw new Error('Not connected to CalDAV server');
    }

    try {
      // Fetch all calendar objects from the calendar
      const objects = await this.client.fetchCalendarObjects({
        calendar: this.calendar
      });

      // Filter for VTODO objects only
      return objects.filter(obj => obj.data.includes('BEGIN:VTODO'));
    } catch (error) {
      console.error('Failed to fetch VTODOs:', error);
      throw error;
    }
  }

  /**
   * Fetch a specific VTODO by UID
   */
  async fetchVTODOByUID(uid: string): Promise<DAVCalendarObject | null> {
    const vtodos = await this.fetchVTODOs();
    return vtodos.find(vtodo => this.mapper.extractUID(vtodo.data) === uid) || null;
  }

  /**
   * Create a new VTODO on the CalDAV server
   */
  async createVTODO(vtodoData: string, uid: string): Promise<void> {
    if (!this.client || !this.calendar) {
      throw new Error('Not connected to CalDAV server');
    }

    try {
      const filename = `${uid}.ics`;
      const url = `${this.calendar.url}/${filename}`;

      await this.client.createCalendarObject({
        calendar: this.calendar,
        filename: filename,
        iCalString: vtodoData
      });
    } catch (error) {
      console.error('Failed to create VTODO:', error);
      throw error;
    }
  }

  /**
   * Update an existing VTODO on the CalDAV server
   */
  async updateVTODO(vtodo: DAVCalendarObject, newData: string): Promise<void> {
    if (!this.client || !this.calendar) {
      throw new Error('Not connected to CalDAV server');
    }

    try {
      await this.client.updateCalendarObject({
        calendarObject: {
          ...vtodo,
          data: newData
        }
      });
    } catch (error) {
      console.error('Failed to update VTODO:', error);
      throw error;
    }
  }

  /**
   * Delete a VTODO from the CalDAV server
   */
  async deleteVTODO(vtodo: DAVCalendarObject): Promise<void> {
    if (!this.client || !this.calendar) {
      throw new Error('Not connected to CalDAV server');
    }

    try {
      await this.client.deleteCalendarObject({
        calendarObject: vtodo
      });
    } catch (error) {
      console.error('Failed to delete VTODO:', error);
      throw error;
    }
  }

  /**
   * Delete a VTODO by UID
   */
  async deleteVTODOByUID(uid: string): Promise<void> {
    const vtodo = await this.fetchVTODOByUID(uid);
    if (vtodo) {
      await this.deleteVTODO(vtodo);
    }
  }

  /**
   * Test connection to CalDAV server
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.connect();
      return {
        success: true,
        message: `Successfully connected to calendar '${this.settings.calendarName}'`
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get the VTODO mapper instance
   */
  getMapper(): VTODOMapper {
    return this.mapper;
  }
}
