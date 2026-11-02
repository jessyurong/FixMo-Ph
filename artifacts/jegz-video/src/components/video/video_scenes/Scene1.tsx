import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 1800),
      setTimeout(() => setPhase(4), 3200),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, filter: 'blur(10px)' }}
      transition={{ duration: 0.8 }}
    >
      <div className="text-center px-[4vw] relative z-10">
        <motion.div
          className="inline-block px-4 py-1 mb-[2vh] rounded-full bg-accent/20 border border-accent/50 text-accent font-mono text-[1vw]"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        >
          SYSTEM INITIALIZED
        </motion.div>
        
        <motion.h1 
          className="text-[6vw] font-black tracking-tighter text-white leading-none mb-[2vh]"
        >
          {'JEGZ'.split('').map((char, i) => (
            <motion.span 
              key={i} 
              style={{ display: 'inline-block' }}
              initial={{ opacity: 0, y: 40, rotateX: -40 }}
              animate={phase >= 2 ? { opacity: 1, y: 0, rotateX: 0 } : { opacity: 0, y: 40, rotateX: -40 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20, delay: phase >= 2 ? i * 0.05 : 0 }}
            >
              {char}
            </motion.span>
          ))}
          <motion.span
            className="text-primary ml-4"
            initial={{ opacity: 0, x: -20 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
            transition={{ delay: 0.4 }}
          >
            MOBILE
          </motion.span>
        </motion.h1>

        <motion.p 
          className="text-[2vw] text-white/60 font-medium"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5 }}
        >
          Advanced POS for Repair Shops
        </motion.p>
      </div>
    </motion.div>
  );
}
