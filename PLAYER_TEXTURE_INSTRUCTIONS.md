# Player Texture Generation Instructions for ChatGPT

## Overview
Generate a UV texture atlas for a blocky robot character in a voxel-style game similar to Minecraft.

## Character Specifications
- **Model Type**: Simple rectangular box (not humanoid)
- **Dimensions**: 0.6 × 1.8 × 0.6 blocks (width × height × depth)
- **Style**: Pixelated/voxel art style
- **Theme**: Robotic/mechanical runner

## Texture Requirements
- **Output Size**: 256×256 pixels
- **Format**: PNG with transparent background
- **Art Style**: Pixel art with clean, sharp edges
- **Sampling**: Point/Nearest neighbor (no anti-aliasing)

## UV Layout Map
The texture must follow this exact UV layout:

```
256x256 pixels divided into 4x3 grid (each cell is 64x64 pixels)

+--------+--------+--------+--------+
|        |  TOP   |        |        |
|        | (head) |        |        |
| Unused | 64x64  | Unused | Unused |
|        |        |        |        |
+--------+--------+--------+--------+
|  LEFT  | FRONT  | RIGHT  | BACK   |
|  side  | (face) |  side  |        |
| 64x192 | 64x192 | 64x192 | 64x192 |
|        |        |        |        |
+--------+--------+--------+--------+
|        | BOTTOM |        |        |
| Unused | (feet) | Unused | Unused |
|        | 64x64  |        |        |
|        |        |        |        |
+--------+--------+--------+--------+
```

## Face-Specific Design Guidelines

### FRONT (Column 2, Row 2)
- Main robot face
- Glowing red LED eyes or visor
- Mechanical mouth grille or speaker mesh
- Small status lights or indicators
- Chest panel with logo or designation number

### BACK (Column 4, Row 2)
- Exposed circuitry or heat vents
- Exhaust ports or cooling fans
- Cable management panels
- Power core or battery indicator
- Warning labels or maintenance access

### LEFT/RIGHT SIDES (Columns 1 & 3, Row 2)
- Arm attachment points or shoulder joints
- Side vents or cooling fins
- Access panels with visible screws/rivets
- Hydraulic pistons or servo details
- Hazard stripes or identification markings

### TOP (Column 2, Row 1)
- Antenna or sensor array
- Access hatch or maintenance panel
- Heat sink fins
- Status LED array
- Model/serial number plate

### BOTTOM (Column 2, Row 3)
- Foot treads or grip patterns
- Shock absorbers or springs
- Hydraulic foot mechanisms
- Anti-slip texturing
- Ground contact sensors

## Color Palette
- **Primary**: Metallic grays (#808080, #A0A0A0, #606060)
- **Accent**: Bright red (#FF0000, #CC0000) for eyes and details
- **Secondary**: Dark gray/black (#202020, #404040) for joints and gaps
- **Highlights**: White (#FFFFFF) for lights and reflections
- **Warning**: Yellow (#FFFF00) for hazard markings

## Style Notes
1. Keep pixelated aesthetic - no smooth gradients
2. Use dithering for shading if needed
3. Add mechanical details: rivets, panel lines, screws
4. Include subtle weathering: scratches, wear marks
5. Ensure contrast between different surfaces
6. Make the front face clearly distinguishable
7. Add small text details like "RUN-01" or "UNIRUN" if space permits

## Technical Requirements
- Save as "player_texture.png"
- Use indexed color mode if possible for smaller file size
- Ensure clean pixel boundaries (no anti-aliasing)
- Test that the texture tiles properly at UV seams
- Leave unused areas transparent or use a neutral gray

## Example Prompt for Image Generation
"Create a 256x256 pixel UV texture atlas for a blocky robot character. The layout should be a 4x3 grid where the middle row contains the character's sides (left, front, right, back), top row has the head top in column 2, and bottom row has the feet bottom in column 2. Style should be pixel art with a red and gray mechanical robot theme. Include glowing red eyes on the front face, mechanical details on all sides, and make it look like a running android. Keep the pixelated aesthetic with no anti-aliasing."