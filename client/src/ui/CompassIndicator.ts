/**
 * Compass rose HUD overlay showing N/S/E/W relative to camera rotation.
 * Positioned bottom-left of the screen.
 */
export class CompassIndicator {
    private container: HTMLDivElement;
    private rose: HTMLDivElement;

    constructor(parent: HTMLElement) {
        this.container = document.createElement('div');
        this.container.className = 'compass-indicator';

        // Create compass rose with direction labels
        this.rose = document.createElement('div');
        this.rose.className = 'compass-rose';

        const directions: { label: string; cls: string }[] = [
            { label: 'N', cls: 'compass-n' },
            { label: 'E', cls: 'compass-e' },
            { label: 'S', cls: 'compass-s' },
            { label: 'W', cls: 'compass-w' },
        ];

        for (const d of directions) {
            const el = document.createElement('span');
            el.className = `compass-label ${d.cls}`;
            el.textContent = d.label;
            this.rose.appendChild(el);
        }

        // Central dot
        const dot = document.createElement('div');
        dot.className = 'compass-dot';
        this.rose.appendChild(dot);

        // Needle (points toward north)
        const needle = document.createElement('div');
        needle.className = 'compass-needle';
        this.rose.appendChild(needle);

        this.container.appendChild(this.rose);
        parent.appendChild(this.container);
    }

    /**
     * Update compass rotation to match camera orbit angle.
     * The camera's rotationAngle is a Y-axis orbit angle where
     * PI/4 is the initial isometric view. We rotate the compass
     * so that "N" always points toward grid north (z=0).
     *
     * Camera offset: (sin(angle), h, cos(angle)) — the camera looks
     * from that direction toward the center. The "screen up" direction
     * in world space depends on the rotation angle.
     *
     * For isometric top-down view:
     *   - rotationAngle = PI/4 → camera at (+X, +Y, +Z), north (−Z) is screen top-left
     *   - We rotate the compass rose by −rotationAngle so N stays correct.
     */
    update(rotationAngle: number): void {
        // Convert to degrees; negate so visual rotation is correct
        const degrees = (-rotationAngle * 180) / Math.PI;
        this.rose.style.transform = `rotate(${degrees}deg)`;
    }
}
