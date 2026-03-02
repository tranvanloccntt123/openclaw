"use client";

/**
 * React hooks for OpenClaw gateway connection.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { GatewayClient, GatewayRequestError, type GatewayEventFrame } from "./gateway";
import { loadSettings } from "./storage";

export type GatewayConnectionState = "connecting" | "connected" | "disconnected" | "error";

export type UseGatewayOptions = {
  /** Override gateway URL (otherwise uses stored settings) */
  url?: string;
  /** Override token (otherwise uses stored settings) */
  token?: string;
  /** Password for gateway auth */
  password?: string;
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean;
};

export type UseGatewayResult = {
  state: GatewayConnectionState;
  error: string | null;
  client: GatewayClient | null;
  /** Current gateway URL being used */
  gatewayUrl: string;
  request: <T = unknown>(method: string, params?: unknown) => Promise<T>;
  reconnect: () => void;
};

/**
 * Hook to manage gateway connection.
 * Uses stored settings from localStorage if url/token not provided.
 */
export function useGateway(options: UseGatewayOptions = {}): UseGatewayResult {
  // Load settings from localStorage
  const settings = typeof window !== "undefined" ? loadSettings() : null;

  const {
    url = settings?.gatewayUrl || "",
    token = settings?.token || "",
    password,
    autoConnect = true,
  } = options;

  const [state, setState] = useState<GatewayConnectionState>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<GatewayClient | null>(null);

  const connect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.stop();
    }

    setState("connecting");
    setError(null);

    const client = new GatewayClient({
      url,
      token,
      password,
      onHello: () => {
        setState("connected");
        setError(null);
      },
      onClose: (info) => {
        if (info.error) {
          setState("error");
          setError(info.error.message);
        } else {
          setState("disconnected");
        }
      },
      // The GatewayClient constructor now accepts an onEvent callback
      // This allows the client to forward events to a central handler if needed,
      // though useGatewayEvents provides a more React-idiomatic subscription model.
      // For now, we'll pass a no-op as useGatewayEvents will handle subscriptions.
      onEvent: () => {},
    });

    clientRef.current = client;
    client.start();
  }, [url, token, password]);

  useEffect(() => {
    if (autoConnect && url) {
      connect();
    }

    return () => {
      clientRef.current?.stop();
      clientRef.current = null;
    };
  }, [autoConnect, url, connect]);

  const request = useCallback(async <T = unknown>(method: string, params?: unknown): Promise<T> => {
    const client = clientRef.current;
    if (!client) {
      throw new Error("Gateway not connected");
    }
    return client.request<T>(method, params);
  }, []);

  return {
    state,
    error,
    client: clientRef.current,
    gatewayUrl: url,
    request,
    reconnect: connect,
  };
}

/**
 * Hook to subscribe to gateway events.
 * Uses GatewayClient.subscribeEvent / unsubscribeEvent for clean lifecycle management.
 */
export function useGatewayEvents(
  client: GatewayClient | null,
  onEvent: (evt: GatewayEventFrame) => void,
) {
  const callbackRef = useRef(onEvent);

  // Always keep ref up-to-date so the stable listener always calls the latest version
  useEffect(() => {
    callbackRef.current = onEvent;
  });

  useEffect(() => {
    if (!client) {
      return;
    }

    const stableListener = (evt: GatewayEventFrame) => {
      callbackRef.current(evt);
    };

    client.subscribeEvent(stableListener);
    return () => {
      client.unsubscribeEvent(stableListener);
    };
  }, [client]);
}

export { GatewayRequestError };
