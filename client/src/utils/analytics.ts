/**
 * Performance Monitoring and Analytics
 * 
 * This utility tracks key performance metrics and user analytics
 * to help understand app performance and user behavior.
 */

import { logger } from "./logger";

interface PerformanceMetric {
  name: string;
  value: number;
  timestamp: number;
}

interface UserEvent {
  eventName: string;
  properties?: Record<string, any>;
  timestamp: number;
}

class Analytics {
  private metrics: PerformanceMetric[] = [];
  private events: UserEvent[] = [];
  private userId: string | null = null;
  private sessionId: string;
  private maxMetrics = 100; // Keep last 100 metrics
  private maxEvents = 500; // Keep last 500 events

  constructor() {
    this.sessionId = this.generateSessionId();
    this.initPerformanceObserver();
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initialize Performance Observer for Web Vitals
   */
  private initPerformanceObserver() {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) {
      return;
    }

    try {
      // Observe Core Web Vitals.
      // NOTE: "layout-shift" is deliberately omitted — Firefox doesn't
      // support it and logs "Ignoring unsupported entryTypes: layout-shift"
      // on every load. The observed metrics only feed the (silenced) logger,
      // so the missing entry type costs nothing.
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.trackMetric(entry.name, entry.startTime);
        }
      });

      observer.observe({ entryTypes: ['paint', 'navigation', 'largest-contentful-paint', 'first-input'] });
    } catch (error) {
      // console.warn('Performance Observer not supported:', error);
    }
  }

  /**
   * Set the current user ID
   */
  setUserId(userId: string) {
    this.userId = userId;
  }

  /**
   * Track a performance metric
   */
  trackMetric(name: string, value: number) {
    const metric: PerformanceMetric = {
      name,
      value,
      timestamp: Date.now(),
    };

    this.metrics.push(metric);
    
    // Keep only the most recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Log in development only
    logger.log(`[Analytics] Metric: ${name} = ${value}ms`);
  }

  /**
   * Track a user event
   */
  trackEvent(eventName: string, properties?: Record<string, any>) {
    const event: UserEvent = {
      eventName,
      properties: {
        ...properties,
        userId: this.userId,
        sessionId: this.sessionId,
      },
      timestamp: Date.now(),
    };

    this.events.push(event);
    
    // Keep only the most recent events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Log in development only
    logger.log(`[Analytics] Event: ${eventName}`, properties);
  }

  /**
   * Track page view
   */
  trackPageView(pageName: string, properties?: Record<string, any>) {
    this.trackEvent('page_view', {
      page: pageName,
      ...properties,
    });

    // Track page load time
    if (typeof window !== 'undefined' && window.performance) {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      if (navigation) {
        this.trackMetric('page_load_time', navigation.loadEventEnd - navigation.fetchStart);
        this.trackMetric('dom_content_loaded', navigation.domContentLoadedEventEnd - navigation.fetchStart);
      }
    }
  }

  /**
   * Track user interaction
   */
  trackInteraction(action: string, target: string, properties?: Record<string, any>) {
    this.trackEvent('user_interaction', {
      action,
      target,
      ...properties,
    });
  }

  /**
   * Track API call
   */
  trackApiCall(endpoint: string, duration: number, success: boolean) {
    this.trackMetric(`api_${endpoint.replace(/\//g, '_')}`, duration);
    this.trackEvent('api_call', {
      endpoint,
      duration,
      success,
    });
  }

  /**
   * Track error
   */
  trackError(error: Error, context?: Record<string, any>) {
    this.trackEvent('error', {
      message: error.message,
      stack: error.stack,
      ...context,
    });
  }

  /**
   * Get all metrics
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * Get all events
   */
  getEvents(): UserEvent[] {
    return [...this.events];
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    const summary: Record<string, { avg: number; min: number; max: number; count: number }> = {};

    for (const metric of this.metrics) {
      if (!summary[metric.name]) {
        summary[metric.name] = {
          avg: metric.value,
          min: metric.value,
          max: metric.value,
          count: 1,
        };
      } else {
        const s = summary[metric.name];
        s.count++;
        s.avg = (s.avg * (s.count - 1) + metric.value) / s.count;
        s.min = Math.min(s.min, metric.value);
        s.max = Math.max(s.max, metric.value);
      }
    }

    return summary;
  }

  /**
   * Clear all data
   */
  clear() {
    this.metrics = [];
    this.events = [];
  }
}

// Singleton instance
export const analytics = new Analytics();

// Convenience functions
export const trackPageView = (page: string, properties?: Record<string, any>) => {
  analytics.trackPageView(page, properties);
};


