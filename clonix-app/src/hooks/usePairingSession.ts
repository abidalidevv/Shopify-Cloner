// clonix-app/src/hooks/usePairingSession.ts
import { useState, useEffect, useCallback } from "react";
import type { PairingSession } from "../types/clonix";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function generateCode(): string {
  let result = "";
  for (let i = 0; i < 8; i++) {
    if (i === 4) result += "-";
    result += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  }
  return result;
}

export function usePairingSession(sourceShop: string) {
  const [session, setSession] = useState<PairingSession>(() => ({
    code: generateCode(),
    sourceShop,
    status: "PENDING_CLAIM",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    secondsRemaining: 15 * 60,
  }));

  const regenerateCode = useCallback(() => {
    const newCode = generateCode();
    setSession({
      code: newCode,
      sourceShop,
      status: "PENDING_CLAIM",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      secondsRemaining: 15 * 60,
    });
  }, [sourceShop]);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(session.code);
  }, [session.code]);

  const authorizeClaim = useCallback((code: string, destShop: string) => {
    setSession((prev) => ({
      ...prev,
      code,
      destShop,
      status: "ACTIVE",
    }));
  }, []);

  // Timer countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setSession((prev) => {
        if (prev.secondsRemaining <= 1) {
          return { ...prev, status: "EXPIRED", secondsRemaining: 0 };
        }
        return { ...prev, secondsRemaining: prev.secondsRemaining - 1 };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return {
    session,
    regenerateCode,
    copyCode,
    authorizeClaim,
  };
}
