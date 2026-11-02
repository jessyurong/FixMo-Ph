import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video/hooks';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = { open: 4000, features: 4500, tech: 4000, management: 4000, close: 4000 };

const bgPositions = [
  { x: '-10%', y: '-10%', scale: 1.2, opacity: 0.15 },
  { x: '10%', y: '10%', scale: 1, opacity: 0.2 },
  { x: '-5%', y: '15%', scale: 1.3, opacity: 0.1 },
  { x: '15%', y: '-5%', scale: 0.9, opacity: 0.15 },
  { x: '0%', y: '0%', scale: 1.1, opacity: 0.2 },
];

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background">
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div 
          className="absolute w-[80vw] h-[80vw] rounded-full blur-[100px]"
          style={{ background: 'radial-gradient(circle, hsl(var(--primary)), transparent)' }}
          animate={bgPositions[currentScene]}
          transition={{ duration: 2, ease: 'easeInOut' }}
        />
        <motion.div 
          className="absolute right-0 bottom-0 w-[60vw] h-[60vw] rounded-full blur-[80px]"
          style={{ background: 'radial-gradient(circle, hsl(var(--accent)), transparent)' }}
          animate={{
            x: ['10%', '-20%', '0%'],
            y: ['0%', '-20%', '10%'],
            scale: [1, 1.2, 0.9]
          }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <AnimatePresence mode="popLayout">
        {currentScene === 0 && <Scene1 key="open" />}
        {currentScene === 1 && <Scene2 key="features" />}
        {currentScene === 2 && <Scene3 key="tech" />}
        {currentScene === 3 && <Scene4 key="management" />}
        {currentScene === 4 && <Scene5 key="close" />}
      </AnimatePresence>
    </div>
  );
}
