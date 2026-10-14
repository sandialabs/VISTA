import {
  applyRescale,
  createPt3PerspectiveProjector,
  getPt3CameraClippingRange,
  getPt3CameraDistance,
  getMprAxisMirrorScale,
  getPhysicalBounds,
  getPt3ViewSize,
  getPt3WorldScale,
  mapWindowLevel,
  normalizeAxisMirrorScale,
  opacityCorrection,
  physicalToVoxel,
  pointInsideCropBox,
  voxelToPhysical,
} from '../pt3VolumeGeometry';
import * as THREE from 'three';
import { CT_TRANSFER_PRESETS, generateTransferFunctionLut } from '../pt3TransferFunctions';

test('voxel to physical preserves anisotropic spacing and origin', () => {
  const metadata = { dimensions: [10, 20, 30], spacing: [0.5, 0.75, 2], origin: [10, 20, -5] };
  expect(voxelToPhysical([2, 4, 3], metadata)).toEqual([11, 23, 1]);
  expect(physicalToVoxel([11, 23, 1], metadata)).toEqual([2, 4, 3]);
});

test('voxel transform supports non-identity orthonormal direction', () => {
  const metadata = { spacing: [1, 2, 3], origin: [0, 0, 0], direction: [0, -1, 0, 1, 0, 0, 0, 0, 1] };
  const physical = voxelToPhysical([2, 3, 4], metadata);
  expect(physical).toEqual([-6, 2, 12]);
  expect(physicalToVoxel(physical, metadata).map((v) => Math.round(v))).toEqual([2, 3, 4]);
});

test('bounds, rescale, window level, opacity, and crop helpers are deterministic', () => {
  const metadata = { dimensions: [3, 4, 5], spacing: [2, 3, 4], rescaleSlope: 2, rescaleIntercept: -1024 };
  expect(getPhysicalBounds(metadata).size).toEqual([4, 9, 16]);
  expect(applyRescale(512, metadata)).toBe(0);
  expect(mapWindowLevel(40, 400, 40)).toBeCloseTo(0.5);
  expect(opacityCorrection(0.5, 2, 1)).toBeCloseTo(0.75);
  expect(pointInsideCropBox([1, 1, 1], { enabled: true, min: [0, 0, 0], max: [2, 2, 2] })).toBe(true);
  expect(pointInsideCropBox([3, 1, 1], { enabled: true, min: [0, 0, 0], max: [2, 2, 2] })).toBe(false);
});

test('transfer function LUT encodes CT presets with opacity', () => {
  const lut = generateTransferFunctionLut({ preset: CT_TRANSFER_PRESETS.bone, scalarRange: [-1024, 3071], opacityMultiplier: 1 });
  expect(lut).toHaveLength(1024);
  expect(lut[1023]).toBeGreaterThan(0);
});

test('maps MPR projection mirrors onto the matching physical 3D axes', () => {
  expect(getMprAxisMirrorScale()).toEqual({ x: 1, y: 1, z: 1 });
  expect(getMprAxisMirrorScale({ sagittal: true })).toEqual({ x: -1, y: 1, z: 1 });
  expect(getMprAxisMirrorScale({ coronal: true })).toEqual({ x: 1, y: -1, z: 1 });
  expect(getMprAxisMirrorScale({ axial: true })).toEqual({ x: 1, y: 1, z: -1 });
  expect(getMprAxisMirrorScale({ axial: true, coronal: true, sagittal: true })).toEqual({ x: -1, y: -1, z: -1 });
});

test('normalizes renderer mirror scales to stable positive or negative unit signs', () => {
  expect(normalizeAxisMirrorScale()).toEqual({ x: 1, y: 1, z: 1 });
  expect(normalizeAxisMirrorScale({ x: -12, y: '-1', z: 0 })).toEqual({ x: -1, y: -1, z: 1 });
  expect(normalizeAxisMirrorScale({ x: 2, y: Number.NaN, z: undefined })).toEqual({ x: 1, y: 1, z: 1 });
});

test('converts source row-down coordinates into a Y-up PT3 world', () => {
  expect(getPt3WorldScale()).toEqual({ x: 1, y: -1, z: 1 });
  expect(getPt3WorldScale({ x: -1, y: -1, z: -1 })).toEqual({ x: -1, y: 1, z: -1 });
});

test('uses full voxel extents for the shared PT3 camera', () => {
  const metadata = { dimensions: [5, 4, 3], spacing: [2, 3, 4] };
  expect(getPt3ViewSize(metadata)).toEqual([10, 12, 12]);
  expect(getPt3CameraDistance(metadata)).toBeCloseTo(26.4);
});

test('preserves sub-unit and single-voxel physical extents and camera clipping', () => {
  expect(getPt3ViewSize({ dimensions: [128, 1, 1], spacing: [0.08, 0.08, 0.08] }))
    .toEqual([10.24, 0.08, 0.08]);
  const metadata = { dimensions: [1, 1, 1], spacing: [0.001, 0.002, 0.003] };
  expect(getPt3ViewSize(metadata)).toEqual([0.001, 0.002, 0.003]);
  expect(getPt3CameraDistance(metadata)).toBeCloseTo(0.0066);
  const clipping = getPt3CameraClippingRange(metadata);
  expect(clipping.near).toBeLessThan(getPt3CameraDistance(metadata));
  expect(clipping.far).toBeGreaterThan(getPt3CameraDistance(metadata));
});

const mirrorCombinations = [-1, 1].flatMap((x) => (
  [-1, 1].flatMap((y) => [-1, 1].map((z) => ({ x, y, z })))
));

test.each([
  {
    rotation: { x: 0, y: 0 }, zoom: 1, width: 640, height: 480,
    direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  },
  {
    rotation: { x: -22, y: 32 }, zoom: 1.7, width: 777, height: 513,
    direction: [0, -1, 0, 1, 0, 0, 0, 0, 1],
  },
  {
    rotation: { x: 72, y: -147 }, zoom: 0.2, width: 420, height: 960,
    direction: [-1, 0, 0, 0, 1, 0, 0, 0, 1],
  },
])('matches the Three.js POV for every corner and mirror combination (%#)', ({
  rotation, zoom, width, height, direction,
}) => {
  const metadata = {
    dimensions: [5, 4, 3],
    spacing: [2, 3, 4],
    origin: [10, 20, 30],
    direction,
  };
  const cornerIndices = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => [
    x * (metadata.dimensions[0] - 1),
    y * (metadata.dimensions[1] - 1),
    z * (metadata.dimensions[2] - 1),
  ])));

  mirrorCombinations.forEach((mirrorScale) => {
    const projector = createPt3PerspectiveProjector({ metadata, width, height, rotation, zoom, mirrorScale });
    const group = new THREE.Object3D();
    const worldScale = getPt3WorldScale(mirrorScale);
    group.rotation.set(rotation.x * Math.PI / 180, rotation.y * Math.PI / 180, 0);
    group.scale.set(worldScale.x, worldScale.y, worldScale.z);
    group.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 10000);
    camera.position.z = getPt3CameraDistance(metadata);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    cornerIndices.forEach((voxelPoint) => {
      const projected = projector(voxelToPhysical(voxelPoint, metadata));
      const local = new THREE.Vector3(...voxelPoint.map((value, axis) => (
        (value - (metadata.dimensions[axis] - 1) / 2) * metadata.spacing[axis]
      )));
      const expectedWorld = local.applyMatrix4(group.matrixWorld);
      const expectedNdc = expectedWorld.clone().project(camera);
      const expectedPixelsPerWorldUnit = (height / 2)
        / Math.tan((38 * Math.PI / 180) / 2)
        * zoom
        / (getPt3CameraDistance(metadata) - expectedWorld.z);

      expect(projected[0]).toBeCloseTo((expectedNdc.x + 1) * width / 2, 7);
      expect(projected[1]).toBeCloseTo((1 - expectedNdc.y) * height / 2, 7);
      expect(projected[2]).toBeCloseTo(expectedWorld.z, 8);
      expect(projected[3]).toBeCloseTo(expectedPixelsPerWorldUnit, 8);
    });
  });
});

test('keeps the top of an unmirrored XY source above its bottom in 3D', () => {
  const metadata = { dimensions: [5, 4, 3], spacing: [1, 1, 1] };
  const bounds = getPhysicalBounds(metadata);
  const center = bounds.min.map((value, axis) => value + bounds.size[axis] / 2);
  const projector = createPt3PerspectiveProjector({ metadata, width: 400, height: 300, rotation: { x: 0, y: 0 } });
  const top = projector([center[0], bounds.min[1], center[2]]);
  const bottom = projector([center[0], bounds.max[1], center[2]]);
  expect(top[1]).toBeLessThan(bottom[1]);
});
