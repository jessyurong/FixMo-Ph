import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 3500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center bg-background"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <div className="text-center">
        <motion.div
          className="w-[10vw] h-[10vw] mx-auto rounded-2xl bg-gradient-to-br from-primary to-accent mb-[4vh] shadow-[0_0_50px_rgba(234,179,8,0.3)]"
          initial={{ opacity: 0, scale: 0, rotate: -45 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1, rotate: 0 } : { opacity: 0, scale: 0, rotate: -45 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        />
        <motion.h1 
          className="text-[5vw] font-black text-white leading-none mb-[2vh]"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        >
          JEGZ Mobile Repair
        </motion.h1>
        <motion.p
          className="text-[2vw] text-accent font-medium"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.3 }}
        >
          Your Repair Shop, Fully Managed.
        </motion.p>
      </div>
    </motion.div>
  );
}
