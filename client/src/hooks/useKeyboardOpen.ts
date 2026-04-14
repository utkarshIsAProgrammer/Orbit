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

// detect visualViewport resize; lock body scroll when keyboard is open

// use visualViewport API instead of window.innerHeight for accurate detection
