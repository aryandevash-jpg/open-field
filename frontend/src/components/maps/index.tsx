"use client";

import dynamic from "next/dynamic";

const placeholder = () => <div className="flex h-80 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-sm text-slate-500">Loading map…</div>;

export const PointPicker = dynamic(() => import("./LeafletMaps").then((m) => m.PointPicker), { ssr: false, loading: placeholder });
export const AreaDrawer = dynamic(() => import("./LeafletMaps").then((m) => m.AreaDrawer), { ssr: false, loading: placeholder });
export const OverviewMap = dynamic(() => import("./LeafletMaps").then((m) => m.OverviewMap), { ssr: false, loading: placeholder });

export type { MapArea, MapPoint } from "./LeafletMaps";
