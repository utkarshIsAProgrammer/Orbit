import { useState, useEffect } from "react";

export function useKeyboardOpen(): boolean {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    const checkKeyboard = () => {
      const vv = window.visualViewport;
      if (vv) {
        const fullHeight = window.screen.height;
        const heightDiff = fullHeight - vv.height;
        setIsKeyboardOpen(heightDiff > 150 && vv.height < 600);
      }
    };
    checkKeyboard();
    window.visualViewport?.addEventListener("resize", checkKeyboard);
    return () => window.visualViewport?.removeEventListener("resize", checkKeyboard);
  }, []);

  return isKeyboardOpen;
}
