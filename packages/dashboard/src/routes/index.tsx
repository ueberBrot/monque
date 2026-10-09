import { createFileRoute, Navigate } from "@tanstack/react-router";

const Home = () => <Navigate to="/queue-views" replace />;
export const Route = createFileRoute("/")({
  component: Home,
});
