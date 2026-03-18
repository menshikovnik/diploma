import * as faceMeshModule from '@mediapipe/face_mesh/face_mesh.js';

const resolvedFaceMesh =
  faceMeshModule.FaceMesh ??
  faceMeshModule.default?.FaceMesh ??
  faceMeshModule.default;

export const FaceMesh = resolvedFaceMesh;
export * from '@mediapipe/face_mesh/face_mesh.js';
