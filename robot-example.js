// Example: Creating a complex multi-part entity in noa-engine

function createRobotCharacter(noa, position) {
    const scene = noa.rendering.getScene();
    
    // Create materials
    const robotMat = noa.rendering.makeStandardMaterial('robotMat');
    robotMat.diffuseColor = new BABYLON.Color3(0.8, 0.1, 0.1);
    robotMat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    
    // IMPORTANT: Use TransformNode as parent (not a mesh)
    // This is more efficient and doesn't interfere with rendering
    const robotRoot = new BABYLON.TransformNode("robotRoot", scene);
    
    // Create body parts as children
    const torso = BABYLON.MeshBuilder.CreateBox('torso', {
        width: 0.5,
        height: 0.6,
        depth: 0.25
    }, scene);
    torso.material = robotMat;
    torso.parent = robotRoot;
    torso.position.y = 0; // Relative to parent
    
    const head = BABYLON.MeshBuilder.CreateBox('head', {
        width: 0.3,
        height: 0.3,
        depth: 0.3
    }, scene);
    head.material = robotMat;
    head.parent = robotRoot;
    head.position.y = 0.45; // Position relative to parent
    
    // Arms
    const leftArm = BABYLON.MeshBuilder.CreateBox('leftArm', {
        width: 0.12,
        height: 0.5,
        depth: 0.12
    }, scene);
    leftArm.material = robotMat;
    leftArm.parent = robotRoot;
    leftArm.position.set(-0.35, 0, 0);
    leftArm.setPivotPoint(new BABYLON.Vector3(0, 0.25, 0)); // Set pivot for rotation
    
    const rightArm = BABYLON.MeshBuilder.CreateBox('rightArm', {
        width: 0.12,
        height: 0.5,
        depth: 0.12
    }, scene);
    rightArm.material = robotMat;
    rightArm.parent = robotRoot;
    rightArm.position.set(0.35, 0, 0);
    rightArm.setPivotPoint(new BABYLON.Vector3(0, 0.25, 0));
    
    // Legs
    const leftLeg = BABYLON.MeshBuilder.CreateBox('leftLeg', {
        width: 0.15,
        height: 0.6,
        depth: 0.15
    }, scene);
    leftLeg.material = robotMat;
    leftLeg.parent = robotRoot;
    leftLeg.position.set(-0.15, -0.6, 0);
    leftLeg.setPivotPoint(new BABYLON.Vector3(0, 0.3, 0));
    
    const rightLeg = BABYLON.MeshBuilder.CreateBox('rightLeg', {
        width: 0.15,
        height: 0.6,
        depth: 0.15
    }, scene);
    rightLeg.material = robotMat;
    rightLeg.parent = robotRoot;
    rightLeg.position.set(0.15, -0.6, 0);
    rightLeg.setPivotPoint(new BABYLON.Vector3(0, 0.3, 0));
    
    // IMPORTANT: Add the root to the scene for octree optimization
    noa.rendering.addMeshToScene(robotRoot);
    
    // Create the entity
    const entityId = noa.entities.add(position, 1, 1.8);
    
    // Add physics component
    noa.entities.addComponent(entityId, noa.entities.names.physics);
    
    // IMPORTANT: Attach only the root TransformNode to the entity
    noa.entities.addComponent(entityId, noa.entities.names.mesh, {
        mesh: robotRoot,
        offset: [0, 0.9, 0] // Adjust to center the model on the entity
    });
    
    // Animation setup
    let animTime = 0;
    scene.registerBeforeRender(() => {
        animTime += 0.05;
        
        // Animate legs
        leftLeg.rotation.x = Math.sin(animTime) * 0.5;
        rightLeg.rotation.x = Math.sin(animTime + Math.PI) * 0.5;
        
        // Animate arms (opposite to legs)
        leftArm.rotation.x = Math.sin(animTime + Math.PI) * 0.3;
        rightArm.rotation.x = Math.sin(animTime) * 0.3;
        
        // Slight torso rotation
        torso.rotation.y = Math.sin(animTime * 2) * 0.05;
    });
    
    // Store references for later use
    robotRoot.robotParts = {
        torso, head, leftArm, rightArm, leftLeg, rightLeg
    };
    
    return entityId;
}

// Alternative: Using a merged mesh (if animation isn't needed)
function createStaticComplexEntity(noa, position) {
    const scene = noa.rendering.getScene();
    
    // Create all parts
    const parts = [];
    // ... create parts ...
    
    // Merge into single mesh
    const merged = BABYLON.Mesh.MergeMeshes(parts, true, true);
    
    // Add to entity
    const entityId = noa.entities.add(position, 1, 2);
    noa.entities.addComponent(entityId, noa.entities.names.mesh, {
        mesh: merged,
        offset: [0, 1, 0]
    });
    
    return entityId;
}

// Key Points:
// 1. Use TransformNode as root (not an invisible mesh)
// 2. All visible parts are children of the root
// 3. Only attach the root to the noa entity
// 4. Call noa.rendering.addMeshToScene() for performance
// 5. Set pivot points for proper rotation
// 6. Animate in scene.registerBeforeRender()