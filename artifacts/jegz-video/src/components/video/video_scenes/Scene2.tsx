import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1400),
      setTimeout(() => setPhase(4), 2000),
      setTimeout(() => setPhase(5), 3500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const features = [
    { title: "Smart POS", desc: "Fast checkout" },
    { title: "Inventory", desc: "Android & iPhone" },
    { title: "Cash Drawer", desc: "Cash & GCash" },
  ];

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col justify-center px-[8vw]"
      initial={{ opacity: 0, x: '10vw' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '-10vw' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.h2 
        className="text-[4vw] font-bold text-white mb-[4vh] leading-tight"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      >
        Everything you need.<br/>
        <span className="text-accent">In one place.</span>
      </motion.h2>

      <div className="flex gap-[2vw]">
        {features.map((f, i) => (
          <motion.div 
            key={i}
            className="flex-1 bg-white/5 border border-white/10 p-[2vw] rounded-2xl"
            initial={{ opacity: 0, y: 40, scale: 0.9 }}
            animate={phase >= i + 2 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 40, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            <h3 className="text-[1.5vw] font-bold text-white mb-[1vh]">{f.title}</h3>
            <p className="text-[1vw] text-white/60">{f.desc}</p>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
