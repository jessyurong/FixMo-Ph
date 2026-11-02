import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 3000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center flex-col"
      initial={{ opacity: 0, y: '-5vh' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.6 }}
    >
      <motion.div 
        className="grid grid-cols-2 gap-[2vw] w-[60vw]"
        initial={{ opacity: 0, rotateX: 20 }}
        animate={phase >= 1 ? { opacity: 1, rotateX: 0 } : { opacity: 0, rotateX: 20 }}
        transition={{ duration: 0.8 }}
      >
        <div className="bg-white/5 p-[3vw] rounded-3xl border border-white/10 backdrop-blur-lg">
          <div className="text-accent text-[2vw] font-bold mb-[1vh]">Transactions</div>
          <div className="w-full h-[1vw] bg-white/10 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-accent" 
              initial={{ width: 0 }}
              animate={phase >= 2 ? { width: '80%' } : { width: 0 }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          </div>
        </div>
        <div className="bg-white/5 p-[3vw] rounded-3xl border border-white/10 backdrop-blur-lg">
          <div className="text-primary text-[2vw] font-bold mb-[1vh]">Secure Access</div>
          <div className="w-full h-[1vw] bg-white/10 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-primary" 
              initial={{ width: 0 }}
              animate={phase >= 2 ? { width: '100%' } : { width: 0 }}
              transition={{ duration: 1, ease: 'easeOut', delay: 0.2 }}
            />
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
