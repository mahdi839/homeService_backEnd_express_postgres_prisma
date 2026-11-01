import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { sendResponse } from "./utils/sendResponse.js";
import { notFound } from "./middlewares/notFound.js";

const app = express();

app.use(helmet());
app.use(cors());

if (env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// NOTE: the Stripe webhook route must be registered BEFORE express.json(),
// because it needs the raw request body to verify the signature.
app.use(express.json());

app.get("/", (_req, res) => {
  // res.status(200).json({
  //   success: true,
  //   message: "FixItNow API is running",
  // });
  sendResponse(res,{statusCode:200,message:"FixItNow Running"})
});


app.use(notFound)
export default app;
