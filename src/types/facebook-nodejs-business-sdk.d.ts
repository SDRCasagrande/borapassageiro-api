declare module 'facebook-nodejs-business-sdk' {
    export class UserData {
        setClientIpAddress(ip: string): this;
        setClientUserAgent(userAgent: string): this;
        setFbc(fbc: string): this;
        setFbp(fbp: string): this;
    }

    export class CustomData {
        setCustomProperties(properties: Record<string, any>): this;
    }

    export class ServerEvent {
        setEventName(name: string): this;
        setEventTime(time: number): this;
        setUserData(userData: UserData): this;
        setCustomData(customData: CustomData): this;
        setActionSource(source: string): this;
    }

    export class EventRequest {
        constructor(accessToken: string, pixelId: string);
        setEvents(events: ServerEvent[]): this;
        execute(): Promise<any>;
    }

    export class Content { }
    export class DeliveryCategory { }
}
