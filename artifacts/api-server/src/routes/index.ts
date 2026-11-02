import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import productsRouter from "./products";
import servicesRouter from "./services";
import techniciansRouter from "./technicians";
import transactionsRouter from "./transactions";
import cashDrawerRouter from "./cash-drawer";
import gcashDrawerRouter from "./gcash-drawer";
import defectiveItemsRouter from "./defective-items";
import backjobsRouter from "./backjobs";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import customersRouter from "./customers";
import settingsRouter from "./settings";

const router: IRouter = Router();

// Public routes (no auth required)
router.use(healthRouter);
router.use(authRouter);

// All other routes require authentication
router.use(requireAuth);
router.use(usersRouter);
router.use(settingsRouter);
router.use(productsRouter);
router.use(servicesRouter);
router.use(techniciansRouter);
router.use(transactionsRouter);
router.use(cashDrawerRouter);
router.use(gcashDrawerRouter);
router.use(defectiveItemsRouter);
router.use(backjobsRouter);
router.use(dashboardRouter);
router.use(reportsRouter);
router.use(customersRouter);

export default router;
