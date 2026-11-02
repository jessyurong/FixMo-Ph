import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 600),
      setTimeout(() => setPhase(3), 1000),
      setTimeout(() => setPhase(4), 3000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-[8vw]"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: '5vh' }}
      transition={{ duration: 0.6 }}
    >
      <div className="w-[40vw]">
        <motion.div
          className="text-primary font-mono text-[1.2vw] mb-[2vh]"
          initial={{ opacity: 0, x: -20 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
        >
          // WORKFLOW TRACKING
        </motion.div>
        <motion.h2 
          className="text-[4vw] font-bold text-white leading-tight mb-[2vh]"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        >
          Track every repair.
        </motion.h2>
        <motion.p
          className="text-[1.5vw] text-white/60"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
        >
          Monitor technician performance and manage backjobs/warranty claims with ease.
        </motion.p>
      </div>

      <motion.div 
        className="w-[35vw] aspect-square rounded-full border border-primary/30 relative"
        initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
        animate={phase >= 2 ? { opacity: 1, rotate: 0, scale: 1 } : { opacity: 0, rotate: -90, scale: 0.5 }}
        transition={{ duration: 1, ease: 'easeOut' }}
      >
        <div className="absolute inset-[10%] rounded-full border border-accent/20 border-dashed animate-[spin_20s_linear_infinite]" />
        <div className="absolute inset-[20%] rounded-full bg-primary/10 flex items-center justify-center backdrop-blur-md">
          <div className="text-center font-mono text-white">
            <div className="text-[3vw] font-bold text-primary">100%</div>
            <div className="text-[1vw] text-white/50">ACCOUNTABLE</div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
