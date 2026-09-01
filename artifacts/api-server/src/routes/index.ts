import { Router, type IRouter } from "express";
import healthRouter from "./health";
import matchesRouter from "./matches";

const router: IRouter = Router();

router.use(healthRouter);
router.use(matchesRouter);

export default router;
