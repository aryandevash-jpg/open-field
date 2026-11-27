import app from "./app.js";

const PORT = process.env.PORT || 5050;

console.log("Starting server...");

app.listen(PORT, () => {
  console.log(`OpenField API running on port ${PORT}`);
});