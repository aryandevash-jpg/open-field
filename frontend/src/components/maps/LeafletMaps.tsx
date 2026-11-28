"use client";

// Leaflet touches `window`, so this module is only loaded in the browser via
// the dynamic() wrappers in ./index.tsx. Circle markers avoid Leaflet's
// default marker image assets.

import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { useEffect } from "react";
import type { LatLng } from "@/lib/types";

export const DEFAULT_CENTER: LatLng = { lat: 18.5204, lng: 73.8567 }; // Pune

const Tiles = () => (
  <TileLayer
    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  />
);

function ClickHandler({ onClick }: { onClick: (point: LatLng) => void }) {
  useMapEvents({ click: (event) => onClick({ lat: event.latlng.lat, lng: event.latlng.lng }) });
  return null;
}

function Recenter({ center }: { center: LatLng }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng]);
  }, [center.lat, center.lng, map]);
  return null;
}

// GeoJSON rings are [lng, lat]; Leaflet wants [lat, lng].
const toLeaflet = (ring: number[][]) => ring.map(([lng, lat]) => [lat!, lng!] as [number, number]);

export type MapArea = { id: string; name: string; coordinates: number[][][][] };
export type MapPoint = { id: string; label: string; location: LatLng; color?: string; onClick?: () => void };

export function PointPicker({ value, onChange, height = 320 }: { value: LatLng | null; onChange: (point: LatLng) => void; height?: number }) {
  const center = value ?? DEFAULT_CENTER;
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={13} style={{ height }} className="rounded-md border border-slate-300">
      <Tiles />
      <ClickHandler onClick={onChange} />
      {value && (
        <>
          <Recenter center={value} />
          <CircleMarker center={[value.lat, value.lng]} radius={9} pathOptions={{ color: "#047857", fillOpacity: 0.7 }} />
        </>
      )}
    </MapContainer>
  );
}

export function AreaDrawer({
  points,
  onAddPoint,
  existing = [],
  height = 380,
}: {
  points: LatLng[];
  onAddPoint: (point: LatLng) => void;
  existing?: MapArea[];
  height?: number;
}) {
  // Centre on the first existing area's outer ring (average of its corners).
  const ring = existing[0]?.coordinates[0]?.[0];
  const ringCenter = ring?.length
    ? { lat: ring.reduce((sum, p) => sum + p[1]!, 0) / ring.length, lng: ring.reduce((sum, p) => sum + p[0]!, 0) / ring.length }
    : null;
  const center = points[0] ?? ringCenter ?? DEFAULT_CENTER;
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={12} style={{ height }} className="rounded-md border border-slate-300">
      <Tiles />
      <ClickHandler onClick={onAddPoint} />
      {existing.map((area) =>
        area.coordinates.map((polygon, index) => (
          <Polygon key={`${area.id}-${index}`} positions={polygon.map(toLeaflet)} pathOptions={{ color: "#0369a1", weight: 2, fillOpacity: 0.15 }}>
            <Tooltip>{area.name}</Tooltip>
          </Polygon>
        ))
      )}
      {points.length >= 3 ? (
        <Polygon positions={points.map((p) => [p.lat, p.lng])} pathOptions={{ color: "#047857", dashArray: "4", fillOpacity: 0.25 }} />
      ) : (
        points.length > 1 && <Polyline positions={points.map((p) => [p.lat, p.lng])} pathOptions={{ color: "#047857" }} />
      )}
      {points.map((p, index) => (
        <CircleMarker key={index} center={[p.lat, p.lng]} radius={5} pathOptions={{ color: "#047857", fillOpacity: 1 }} />
      ))}
    </MapContainer>
  );
}

export function OverviewMap({ points = [], areas = [], height = 360 }: { points?: MapPoint[]; areas?: MapArea[]; height?: number }) {
  const first = points[0]?.location ?? DEFAULT_CENTER;
  return (
    <MapContainer center={[first.lat, first.lng]} zoom={12} style={{ height }} className="rounded-md border border-slate-300">
      <Tiles />
      {areas.map((area) =>
        area.coordinates.map((polygon, index) => (
          <Polygon key={`${area.id}-${index}`} positions={polygon.map(toLeaflet)} pathOptions={{ color: "#0369a1", weight: 2, fillOpacity: 0.12 }}>
            <Tooltip>{area.name}</Tooltip>
          </Polygon>
        ))
      )}
      {points.map((point) => (
        <CircleMarker
          key={point.id}
          center={[point.location.lat, point.location.lng]}
          radius={8}
          pathOptions={{ color: point.color ?? "#b45309", fillOpacity: 0.75 }}
          eventHandlers={point.onClick ? { click: point.onClick } : undefined}
        >
          <Tooltip>{point.label}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
