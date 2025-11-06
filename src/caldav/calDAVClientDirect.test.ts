import { CalDAVClientDirect } from './calDAVClientDirect';
import { CalDAVSettings } from '../types';

const mockSettings: CalDAVSettings = {
    serverUrl: 'https://caldav.example.com',
    username: 'testuser',
    password: 'testpass',
    calendarName: 'Tasks',
    syncTag: 'sync',
    syncInterval: 5,
    newTasksDestination: 'Inbox.md',
    newTasksSection: '',
    requireManualConflictResolution: false,
    autoResolveObsidianWins: true
};

describe('CalDAVClientDirect', () => {
    let client: CalDAVClientDirect;

    beforeEach(() => {
        client = new CalDAVClientDirect(mockSettings);
        jest.clearAllMocks();
    });

    it('should construct with correct auth header', () => {
        expect(client).toBeDefined();
        // Auth header should be properly encoded
        const authHeader = (client as any).authHeader;
        expect(authHeader).toContain('Basic ');

        // Verify base64 encoding of username:password
        const decoded = atob(authHeader.replace('Basic ', ''));
        expect(decoded).toBe('testuser:testpass');
    });

    it('should store calendar settings', () => {
        const settings = (client as any).settings;
        expect(settings.serverUrl).toBe('https://caldav.example.com');
        expect(settings.username).toBe('testuser');
        expect(settings.calendarName).toBe('Tasks');
    });

    it('should initialize with null calendar URL', () => {
        const calendarUrl = (client as any).calendarUrl;
        expect(calendarUrl).toBeNull();
    });

    it('should have VTODOMapper instance', () => {
        const mapper = (client as any).mapper;
        expect(mapper).toBeDefined();
        expect(mapper.taskToVTODO).toBeDefined();
        expect(mapper.vtodoToTask).toBeDefined();
    });
});
