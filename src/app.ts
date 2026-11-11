import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { sendResponse } from "./utils/sendResponse.js";
import { notFound } from "./middlewares/notFound.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import authRouter from './modules/auth/auth.route.js'
import categoryRouter from './modules/category/category.route.js'
import technicianRouter from './modules/technician/technician.route.js'
import technicianPublicRouter from './modules/technician/technician.public.route.js'
import serviceRouter from "./modules/service/service.route.js";
const app = express();

app.use(helmet());
app.use(cors());

if (env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

app.use(express.json());

app.get("/", (_req, res) => {
  sendResponse(res, { statusCode: 200, message: "FixItNow Running" })
});

app.use("/api/auth", authRouter)
app.use("/api/categories", categoryRouter)
app.use("/api/technician", technicianRouter)
app.use("/api/technicians", technicianPublicRouter);
app.use("/api/services", serviceRouter);
app.use(notFound);
app.use(errorHandler);
export default app;
