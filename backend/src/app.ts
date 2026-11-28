import express from "express";
import assignmentRoutes from "./modules/assignments/assignment.routes.js";
import collaborationRoutes from "./modules/collaborations/collaboration.routes.js";
import notificationRoutes from "./modules/notifications/notification.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import categoryRoutes from "./modules/category/category.routes.js";
import eventRoutes from "./modules/events/event.routes.js";
import organizationRoutes from "./modules/organizations/organization.routes.js";
import reportRoutes from "./modules/reports/report.routes.js";
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
app.use("/api/v1/events", eventRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use("/api/v1/assignments", assignmentRoutes);
app.use("/api/v1/collaborations", collaborationRoutes);
app.use("/api/v1/notifications", notificationRoutes);

// Must come after all routes.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
