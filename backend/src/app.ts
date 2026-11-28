import express from "express";
import authRoutes from "./modules/auth/auth.routes.js";
import categoryRoutes from "./modules/category/category.routes.js";
import organizationRoutes from "./modules/organizations/organization.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

const app = express();

app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "OpenField API is running",
  });
});

// Authentication routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/organizations", organizationRoutes);
app.use("/api/v1/categories", categoryRoutes);

// Must come after all routes.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
