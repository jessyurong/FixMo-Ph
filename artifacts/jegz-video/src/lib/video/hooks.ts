import { useState, useEffect, useRef } from 'react';

declare global {
  interface Window {
    startRecording?: () => void;
    stopRecording?: () => void;
  }
}

export function useVideoPlayer({ durations }: { durations: Record<string, number> }) {
  const [currentScene, setCurrentScene] = useState(0);
  const keys = Object.keys(durations);
  const hasRecordedRef = useRef(false);

  useEffect(() => {
    // Start recording on mount
    window.startRecording?.();
  }, []);

  useEffect(() => {
    const totalScenes = keys.length;
    if (totalScenes === 0) return;

    const currentDuration = durations[keys[currentScene]];
    
    const timer = setTimeout(() => {
      if (currentScene === totalScenes - 1) {
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          window.stopRecording?.();
        }
        // Loop back to start
        setCurrentScene(0);
      } else {
        setCurrentScene(prev => prev + 1);
      }
    }, currentDuration);

    return () => clearTimeout(timer);
  }, [currentScene, durations, keys]);

  return { currentScene };
}
