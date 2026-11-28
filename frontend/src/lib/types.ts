// Shapes returned by the OpenField API (only the fields the web app uses).

export type Role = "OWNER" | "ADMIN" | "COORDINATOR" | "MEMBER";
export type ReportStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "VERIFIED"
  | "RESOLUTION_PENDING"
  | "RESOLVED"
  | "REOPENED"
  | "REJECTED"
  | "DUPLICATE";
export type AssignmentStatus = "CLAIMED" | "IN_PROGRESS" | "COMPLETED" | "EXPIRED" | "CANCELLED" | "TRANSFERRED";

export type LatLng = { lat: number; lng: number };

export type Me = { id: string; name: string; email: string; isPlatformAdmin: boolean };

export type Category = { id: string; name: string; slug: string; parentId: string | null; isActive: boolean; description: string | null };

export type Report = {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  eventId: string | null;
  submittedByUserId: string;
  status: ReportStatus;
  version: number;
  duplicateOfReportId: string | null;
  createdAt: string;
  location: LatLng;
  media?: { id: string; url: string; contentType: string | null }[];
};

export type HistoryEntry = {
  id: string;
  action: string;
  fromStatus: ReportStatus | null;
  toStatus: ReportStatus | null;
  reason: string | null;
  createdAt: string;
  actor: { id: string; name: string };
};

export type Comment = { id: string; body: string; createdAt: string; author: { id: string; name: string } };

export type Collaboration = {
  id: string;
  status: "INVITED" | "ACCEPTED" | "DECLINED" | "REVOKED";
  organizationId: string;
  organization: { id: string; name: string };
  teams: { team: { id: string; name: string } }[];
  assignment?: {
    id: string;
    status: AssignmentStatus;
    organizationId: string;
    report: { id: string; title: string; status: ReportStatus };
    organization: { id: string; name: string };
  };
};

export type Assignment = {
  id: string;
  reportId: string;
  organizationId: string;
  teamId: string;
  status: AssignmentStatus;
  startDeadlineAt: string;
  startedAt: string | null;
  completedAt: string | null;
  endedAt: string | null;
  completionNote: string | null;
  supersedesAssignmentId: string | null;
  createdAt: string;
  team?: { id: string; name: string };
  organization?: { id: string; name: string };
  report?: { id: string; title: string; status: ReportStatus };
  collaborations?: Collaboration[];
};

export type MyOrganization = { id: string; role: Role; organization: { id: string; name: string; description: string | null } };

export type OrganizationDetail = {
  id: string;
  name: string;
  description: string | null;
  myRole: Role;
  myMembershipId: string;
  memberships: { id: string; role: Role; user: { id: string; name: string; email: string } }[];
  teams: {
    id: string;
    name: string;
    memberships: { id: string; organizationMembership: { id: string; user: { id: string; name: string } } }[];
  }[];
};

export type Capability = { categoryId: string; category: { id: string; name: string; slug: string; parentId: string | null } };

export type ServiceArea = { id: string; name: string; createdAt: string; area: { type: "MultiPolygon"; coordinates: number[][][][] } };

export type Event = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  status: "ACTIVE" | "COMPLETED";
  hostOrganizationId: string;
  hostOrganization?: { id: string; name: string };
};

export type Participation = {
  eventId: string;
  organizationId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  organization?: { id: string; name: string };
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  reportId: string | null;
  eventId: string | null;
  readAt: string | null;
  createdAt: string;
};

export const MANAGER_ROLES: Role[] = ["OWNER", "ADMIN"];
export const COORDINATOR_ROLES: Role[] = ["OWNER", "ADMIN", "COORDINATOR"];
