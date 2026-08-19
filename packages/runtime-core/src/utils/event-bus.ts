const globalEventMap = new Map<string, Function[]>();

export class EventBus {
  static on<T = undefined>(eventName: string, callback: (e: T) => void) {
    const event = globalEventMap.get(eventName);
    if (event) {
      event.push(callback);
    }
    globalEventMap.set(eventName, event || [callback]);
  }

  static off<T = undefined>(eventName: string, callback?: (e: T) => void) {
    const event = globalEventMap.get(eventName);
    if (!callback || !event || event.length === 0) {
      globalEventMap.delete(eventName);
      return;
    }
    globalEventMap.set(
      eventName,
      event.filter((e) => e !== callback)
    );
  }

  static once<T = undefined>(eventName: string, callback: (e: T) => void) {
    const proxyCallback = (e: T) => {
      callback(e);
      this.off(eventName, proxyCallback);
    };
    this.on(eventName, proxyCallback);
  }

  static emit<T = undefined>(eventName: string, value: T) {
    const event = globalEventMap.get(eventName);
    if (!event) {
      return;
    }
    event.forEach((e) => {
      e(value);
    });
  }

  static has(eventName: string) {
    return globalEventMap.has(eventName);
  }

  static get size() {
    return globalEventMap.size;
  }

  static listenerCount(eventName: string) {
    return globalEventMap.get(eventName)?.length || 0;
  }
}

export const EVENTS = {
  APP_MOUNTED: "app-mounted",
  APP_DESTROYED: "app-destroyed",
  __INTERNAL_UPDATE: "__internal_update",
};
