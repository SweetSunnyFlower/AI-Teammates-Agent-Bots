"use client";

import type { FloorMaterials } from "./materials";

type P = { m: FloorMaterials; position: [number, number, number]; rotation?: number };

/** Desk with monitor and stool; the bot sits on the stool (in front, +z). */
export function Desk({ m, position, accent = false }: P & { accent?: boolean }) {
  return (
    <group position={position}>
      <mesh material={m.desk} position={[0, 0.74, 0]}>
        <boxGeometry args={[1.6, 0.07, 0.78]} />
      </mesh>
      {[-0.72, 0.72].map((x) => (
        <mesh key={x} material={m.leg} position={[x, 0.37, 0]}>
          <boxGeometry args={[0.06, 0.74, 0.66]} />
        </mesh>
      ))}
      <mesh material={m.monitor} position={[0, 1.06, -0.2]}>
        <boxGeometry args={[0.66, 0.42, 0.05]} />
      </mesh>
      <mesh material={m.screen} position={[0, 1.06, -0.172]}>
        <boxGeometry args={[0.58, 0.34, 0.01]} />
      </mesh>
      <mesh material={m.monitor} position={[0, 0.82, -0.2]}>
        <boxGeometry args={[0.08, 0.12, 0.08]} />
      </mesh>
      {accent && (
        <mesh material={m.paper} position={[0.5, 0.79, 0.1]} rotation={[0, 0.3, 0]}>
          <boxGeometry args={[0.3, 0.02, 0.22]} />
        </mesh>
      )}
      <mesh material={m.stool} position={[0, 0.3, 0.72]}>
        <cylinderGeometry args={[0.24, 0.24, 0.12, 20]} />
      </mesh>
      <mesh material={m.leg} position={[0, 0.13, 0.72]}>
        <cylinderGeometry args={[0.04, 0.06, 0.26, 10]} />
      </mesh>
    </group>
  );
}

export function Plant({ m, position, size = 1 }: P & { size?: number }) {
  return (
    <group position={position} scale={size}>
      <mesh material={m.pot} position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.24, 0.18, 0.44, 14]} />
      </mesh>
      <mesh material={m.plant} position={[0, 0.78, 0]}>
        <icosahedronGeometry args={[0.38, 0]} />
      </mesh>
      <mesh material={m.plantDark} position={[0.14, 1.08, 0.06]}>
        <icosahedronGeometry args={[0.24, 0]} />
      </mesh>
    </group>
  );
}

export function Couch({ m, position, rotation = 0 }: P) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh material={m.dark} position={[0, 0.25, 0]}>
        <boxGeometry args={[1.7, 0.36, 0.8]} />
      </mesh>
      <mesh material={m.dark} position={[0, 0.6, -0.32]}>
        <boxGeometry args={[1.7, 0.5, 0.18]} />
      </mesh>
      {[-0.8, 0.8].map((x) => (
        <mesh key={x} material={m.dark} position={[x, 0.45, 0]}>
          <boxGeometry args={[0.16, 0.42, 0.8]} />
        </mesh>
      ))}
      <mesh material={m.desk} position={[0, 0.2, 0.95]}>
        <cylinderGeometry args={[0.34, 0.34, 0.06, 18]} />
      </mesh>
    </group>
  );
}

export function Bookshelf({ m, position, rotation = 0 }: P) {
  const books = [m.noteA, m.noteB, m.noteC, m.screen, m.noteA, m.noteC];
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh material={m.wood} position={[0, 0.95, 0]}>
        <boxGeometry args={[1.5, 1.9, 0.36]} />
      </mesh>
      {[0.55, 1.15, 1.7].map((y, row) =>
        books.slice(row, row + 4).map((b, i) => (
          <mesh key={`${row}-${i}`} material={b} position={[-0.5 + i * 0.32, y - 0.12, 0.12]}>
            <boxGeometry args={[0.18, 0.36, 0.2]} />
          </mesh>
        )),
      )}
    </group>
  );
}

export function ServerRack({ m, position }: P) {
  return (
    <group position={position}>
      <mesh material={m.rack} position={[0, 0.95, 0]}>
        <boxGeometry args={[0.7, 1.9, 0.7]} />
      </mesh>
      {[0.5, 0.85, 1.2, 1.55].map((y) => (
        <mesh key={y} material={m.screen} position={[0, y, 0.355]}>
          <boxGeometry args={[0.5, 0.06, 0.01]} />
        </mesh>
      ))}
    </group>
  );
}

export function Whiteboard({ m, position }: P) {
  return (
    <group position={position}>
      <mesh material={m.paper} position={[0, 1.4, 0]}>
        <boxGeometry args={[1.9, 1.0, 0.05]} />
      </mesh>
      {[
        [-0.6, 1.6, m.noteA],
        [-0.25, 1.62, m.noteB],
        [0.15, 1.58, m.noteC],
        [-0.55, 1.25, m.noteC],
        [0.5, 1.3, m.noteA],
      ].map(([x, y, mm], i) => (
        <mesh key={i} material={mm as FloorMaterials["noteA"]} position={[x as number, y as number, 0.035]}>
          <boxGeometry args={[0.24, 0.24, 0.01]} />
        </mesh>
      ))}
    </group>
  );
}

export function MeetingTable({ m, position }: P) {
  return (
    <group position={position}>
      <mesh material={m.desk} position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.75, 0.75, 0.07, 28]} />
      </mesh>
      <mesh material={m.leg} position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.07, 0.12, 0.7, 12]} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <mesh key={i} material={m.stool} position={[Math.cos(a) * 1.05, 0.3, Math.sin(a) * 1.05]}>
            <cylinderGeometry args={[0.2, 0.2, 0.12, 16]} />
          </mesh>
        );
      })}
    </group>
  );
}
