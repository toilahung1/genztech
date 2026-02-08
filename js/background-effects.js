/**
 * Background Effects Script
 * Extracted from index.html for reuse
 */

document.addEventListener('DOMContentLoaded', () => {
    // Check if we are on mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // Check if we are on Safari
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    // ==================== MULTI-LAYER STARFIELD WITH MOBILE OPTIMIZATION ====================
    const canvasFar = document.getElementById('starfield-far');
    const canvasMid = document.getElementById('starfield-mid');
    const canvasNear = document.getElementById('starfield-near');

    // Only proceed if canvases exist
    if (!canvasFar || !canvasMid || !canvasNear) return;

    const ctxFar = canvasFar.getContext('2d');
    const ctxMid = canvasMid.getContext('2d');
    const ctxNear = canvasNear.getContext('2d');

    function resizeCanvases() {
        [canvasFar, canvasMid, canvasNear].forEach(canvas => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        });
    }
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);

    // Reduce particle count on mobile OR Safari for better performance
    let starCountMultiplier = 1;
    if (isMobile) starCountMultiplier = 0.5;
    if (isSafari) starCountMultiplier = 0.4; // Aggressive reduction for Safari

    // Far layer stars - tiny static
    const starsFar = [];
    for (let i = 0; i < Math.floor(200 * starCountMultiplier); i++) {
        starsFar.push({
            x: Math.random() * canvasFar.width,
            y: Math.random() * canvasFar.height,
            radius: Math.random() * 0.8 + 0.2,
            opacity: Math.random() * 0.3 + 0.2
        });
    }

    // Mid layer stars - slow drift
    const starsMid = [];
    for (let i = 0; i < Math.floor(100 * starCountMultiplier); i++) {
        starsMid.push({
            x: Math.random() * canvasMid.width,
            y: Math.random() * canvasMid.height,
            radius: Math.random() * 1.2 + 0.5,
            vx: (Math.random() - 0.5) * ((isMobile || isSafari) ? 0.1 : 0.2),
            vy: (Math.random() - 0.5) * ((isMobile || isSafari) ? 0.1 : 0.2),
            opacity: Math.random() * 0.5 + 0.3
        });
    }

    // Near layer stars - glowing particles
    const starsNear = [];
    for (let i = 0; i < Math.floor(50 * starCountMultiplier); i++) {
        starsNear.push({
            x: Math.random() * canvasNear.width,
            y: Math.random() * canvasNear.height,
            radius: Math.random() * 1.8 + 0.8,
            vx: (Math.random() - 0.5) * ((isMobile || isSafari) ? 0.2 : 0.4),
            vy: (Math.random() - 0.5) * ((isMobile || isSafari) ? 0.2 : 0.4),
            opacity: Math.random() * 0.7 + 0.3,
            pulse: Math.random() * Math.PI * 2
        });
    }

    // Shooting Stars (Comets)
    const shootingStars = [];
    let lastShootingStarTime = 0;

    class ShootingStar {
        constructor() {
            this.reset();
        }

        reset() {
            this.x = Math.random() * canvasFar.width;
            this.y = Math.random() * canvasFar.height * 0.5; // Start in top half
            this.length = Math.random() * 200 + 100; // Longer tail
            this.speed = Math.random() * 2 + 1; // Much slower speed (prevent dizziness)
            this.size = Math.random() * 2 + 1.5; // Bigger size
            // Shoot diagonally down-right or down-left
            this.dirX = 1;
            this.dirY = 1;
            if (Math.random() < 0.5) {
                this.x = -100; // Start further left to avoid pop-in
                this.dirX = 1;
            } else {
                this.x = canvasFar.width + 100; // Start further right
                this.dirX = -1;
            }

            this.vx = this.dirX * this.speed;
            this.vy = this.dirY * this.speed * 0.5; // Flatter angle

            this.opacity = 0;
            this.life = 0;
            this.maxLife = 200; // Live longer
            this.active = true;
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;
            this.life++;

            // Fade in then out
            if (this.life < 20) {
                this.opacity = this.life / 20;
            } else if (this.life > this.maxLife - 40) {
                this.opacity = (this.maxLife - this.life) / 40;
            } else {
                this.opacity = 1;
            }

            if (this.life >= this.maxLife ||
                this.x < -300 || this.x > canvasFar.width + 300 ||
                this.y > canvasFar.height + 300) {
                this.active = false;
            }
        }

        draw(ctx) {
            if (!this.active) return;

            const tailX = this.x - this.vx * (this.length / this.speed);
            const tailY = this.y - this.vy * (this.length / this.speed);

            if (isSafari) {
                // Simplified drawing for Safari: No gradient stroke
                ctx.strokeStyle = `rgba(255, 255, 255, ${this.opacity * 0.8})`;
                ctx.lineWidth = this.size;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(tailX, tailY);
                ctx.stroke();

                // Simple head
                ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size * 1.5, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // Expensive gradient for Chrome/Desktop
                const gradient = ctx.createLinearGradient(this.x, this.y, tailX, tailY);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${this.opacity})`);
                gradient.addColorStop(1, `rgba(255, 255, 255, 0)`);

                ctx.strokeStyle = gradient;
                ctx.lineWidth = this.size;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(tailX, tailY);
                ctx.stroke();

                // Glowing head
                ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size * 1.5, 0, Math.PI * 2);
                ctx.fill();

                // Blueish tint glow
                ctx.fillStyle = `rgba(100, 200, 255, ${this.opacity * 0.5})`;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size * 5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    function animateStarfield() {
        // Far layer (static)
        ctxFar.clearRect(0, 0, canvasFar.width, canvasFar.height);
        starsFar.forEach(star => {
            ctxFar.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
            ctxFar.beginPath();
            ctxFar.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            ctxFar.fill();
        });

        // Spawn Shooting Stars
        const now = Date.now();
        // Fewer shooting stars on Safari
        const spawnRate = isSafari ? 3000 : 1000;

        if (now - lastShootingStarTime > (Math.random() * spawnRate + 500)) {
            const maxStars = isSafari ? 2 : 8;
            if (shootingStars.length < maxStars) {
                shootingStars.push(new ShootingStar());
                lastShootingStarTime = now;
            }
        }

        // Update and Draw Shooting Stars (on Far layer for depth, or Mid)
        // Let's use Mid layer ctxMid to be behind Near stars but visible

        ctxMid.clearRect(0, 0, canvasMid.width, canvasMid.height);

        for (let i = shootingStars.length - 1; i >= 0; i--) {
            const ss = shootingStars[i];
            ss.update();
            ss.draw(ctxMid);
            if (!ss.active) {
                shootingStars.splice(i, 1);
            }
        }

        starsMid.forEach(star => {
            star.x += star.vx;
            star.y += star.vy;
            if (star.x < 0) star.x = canvasMid.width;
            if (star.x > canvasMid.width) star.x = 0;
            if (star.y < 0) star.y = canvasMid.height;
            if (star.y > canvasMid.height) star.y = 0;

            ctxMid.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
            ctxMid.beginPath();
            ctxMid.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            ctxMid.fill();
        });

        // Near layer (glowing) - Simplified on mobile
        ctxNear.clearRect(0, 0, canvasNear.width, canvasNear.height);
        starsNear.forEach(star => {
            star.x += star.vx;
            star.y += star.vy;
            star.pulse += (isMobile ? 0.01 : 0.02);

            if (star.x < 0) star.x = canvasNear.width;
            if (star.x > canvasNear.width) star.x = 0;
            if (star.y < 0) star.y = canvasNear.height;
            if (star.y > canvasNear.height) star.y = 0;

            const pulseOpacity = star.opacity * (0.7 + Math.sin(star.pulse) * 0.3);

            if (isMobile || isSafari) {
                // Simple dot on mobile or Safari to avoid gradients
                ctxNear.fillStyle = `rgba(24, 119, 242, ${pulseOpacity})`;
                ctxNear.beginPath();
                ctxNear.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
                ctxNear.fill();
            } else {
                // Glow effect on desktop Chrome
                const gradient = ctxNear.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.radius * 3);
                gradient.addColorStop(0, `rgba(24, 119, 242, ${pulseOpacity})`);
                gradient.addColorStop(0.5, `rgba(0, 212, 255, ${pulseOpacity * 0.5})`);
                gradient.addColorStop(1, 'rgba(0, 212, 255, 0)');

                ctxNear.fillStyle = gradient;
                ctxNear.beginPath();
                ctxNear.arc(star.x, star.y, star.radius * 3, 0, Math.PI * 2);
                ctxNear.fill();
            }
        });

        requestAnimationFrame(animateStarfield);
    }
    animateStarfield();

    // ==================== CONSTELLATION LINES WITH MOBILE OPTIMIZATION ====================
    const canvasConstellation = document.getElementById('constellation-lines');
    if (canvasConstellation) {
        const ctxConstellation = canvasConstellation.getContext('2d');
        canvasConstellation.width = window.innerWidth;
        canvasConstellation.height = window.innerHeight;

        let constellationPoints = [];
        let scrollVelocity = 0;
        let lastScrollY = 0;

        function initConstellationPoints() {
            constellationPoints = [];
            let pointCount = 15;
            if (isMobile) pointCount = 8;
            if (isSafari) pointCount = 6; // Very few connections on Safari

            for (let i = 0; i < pointCount; i++) {
                constellationPoints.push({
                    x: Math.random() * canvasConstellation.width,
                    y: Math.random() * canvasConstellation.height,
                    connections: []
                });
            }

            // Create connections
            constellationPoints.forEach((point, i) => {
                const numConnections = Math.floor(Math.random() * 2) + 1;
                for (let j = 0; j < numConnections; j++) {
                    const targetIndex = Math.floor(Math.random() * constellationPoints.length);
                    if (targetIndex !== i && !point.connections.includes(targetIndex)) {
                        point.connections.push(targetIndex);
                    }
                }
            });
        }
        initConstellationPoints();

        let constellationOpacity = 0;
        function animateConstellation() {
            if (isMobile) return;

            ctxConstellation.clearRect(0, 0, canvasConstellation.width, canvasConstellation.height);

            // Update opacity based on scroll velocity
            if (Math.abs(scrollVelocity) > 5) {
                constellationOpacity = Math.min(constellationOpacity + 0.02, 0.3);
            } else {
                constellationOpacity = Math.max(constellationOpacity - 0.01, 0);
            }

            if (constellationOpacity > 0) {
                constellationPoints.forEach((point, i) => {
                    point.connections.forEach(targetIndex => {
                        const target = constellationPoints[targetIndex];

                        if (isSafari) {
                            // Simple flat color for Safari
                            ctxConstellation.strokeStyle = `rgba(24, 119, 242, ${constellationOpacity})`;
                        } else {
                            // Gradient for others
                            const gradient = ctxConstellation.createLinearGradient(point.x, point.y, target.x, target.y);
                            gradient.addColorStop(0, `rgba(24, 119, 242, ${constellationOpacity})`);
                            gradient.addColorStop(0.5, `rgba(0, 212, 255, ${constellationOpacity * 0.7})`);
                            gradient.addColorStop(1, `rgba(138, 43, 226, ${constellationOpacity * 0.5})`);
                            ctxConstellation.strokeStyle = gradient;
                        }

                        ctxConstellation.lineWidth = 1;
                        ctxConstellation.beginPath();
                        ctxConstellation.moveTo(point.x, point.y);
                        ctxConstellation.lineTo(target.x, target.y);
                        ctxConstellation.stroke();
                    });
                });
            }

            requestAnimationFrame(animateConstellation);
        }
        if (!isMobile) {
            animateConstellation();
        }

        // Track scroll velocity
        window.addEventListener('scroll', () => {
            const currentScrollY = window.scrollY;
            scrollVelocity = currentScrollY - lastScrollY;
            lastScrollY = currentScrollY;
        });

        // Resize Handler specific for constellation
        window.addEventListener('resize', () => {
            canvasConstellation.width = window.innerWidth;
            canvasConstellation.height = window.innerHeight;
            initConstellationPoints();
        });
    }

    // ==================== DATA PARTICLES WITH MOBILE OPTIMIZATION ====================
    const canvasData = document.getElementById('data-particles');
    if (canvasData) {
        const ctxData = canvasData.getContext('2d');
        canvasData.width = window.innerWidth;
        canvasData.height = window.innerHeight;

        const dataParticles = [];
        let particleCount = 30;
        if (isMobile) particleCount = 15;
        if (isSafari) particleCount = 10; // Very few data particles on Safari

        for (let i = 0; i < particleCount; i++) {
            dataParticles.push({
                x: Math.random() * canvasData.width,
                y: Math.random() * canvasData.height,
                radius: Math.random() * 2 + 1,
                path: {
                    centerX: Math.random() * canvasData.width,
                    centerY: Math.random() * canvasData.height,
                    radiusX: Math.random() * (isMobile ? 50 : 100) + (isMobile ? 25 : 50),
                    radiusY: Math.random() * (isMobile ? 50 : 100) + (isMobile ? 25 : 50),
                    angle: Math.random() * Math.PI * 2,
                    speed: Math.random() * (isMobile ? 0.005 : 0.01) + (isMobile ? 0.003 : 0.005)
                },
                pulse: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.02 + 0.01
            });
        }

        function animateDataParticles() {
            ctxData.clearRect(0, 0, canvasData.width, canvasData.height);

            dataParticles.forEach(particle => {
                // Move along curved path
                particle.path.angle += particle.path.speed;
                particle.x = particle.path.centerX + Math.cos(particle.path.angle) * particle.path.radiusX;
                particle.y = particle.path.centerY + Math.sin(particle.path.angle) * particle.path.radiusY;

                // Pulse effect
                particle.pulse += particle.pulseSpeed;
                const pulseScale = 1 + Math.sin(particle.pulse) * 0.5;

                if (isMobile || isSafari) {
                    // Simple particle on mobile or Safari
                    ctxData.fillStyle = `rgba(24, 119, 242, ${0.6 * pulseScale})`;
                    ctxData.beginPath();
                    ctxData.arc(particle.x, particle.y, particle.radius * pulseScale, 0, Math.PI * 2);
                    ctxData.fill();
                } else {
                    // Glow effect on desktop
                    const gradient = ctxData.createRadialGradient(
                        particle.x, particle.y, 0,
                        particle.x, particle.y, particle.radius * pulseScale * 3
                    );
                    gradient.addColorStop(0, `rgba(24, 119, 242, ${0.8 * pulseScale})`);
                    gradient.addColorStop(0.5, `rgba(0, 212, 255, ${0.4 * pulseScale})`);
                    gradient.addColorStop(1, 'rgba(0, 212, 255, 0)');

                    ctxData.fillStyle = gradient;
                    ctxData.beginPath();
                    ctxData.arc(particle.x, particle.y, particle.radius * pulseScale * 3, 0, Math.PI * 2);
                    ctxData.fill();
                }
            });

            requestAnimationFrame(animateDataParticles);
        }
        animateDataParticles();

        window.addEventListener('resize', () => {
            canvasData.width = window.innerWidth;
            canvasData.height = window.innerHeight;
        });
    }

    // ==================== GSAP AMBIENT RINGS ====================
    if (typeof gsap !== 'undefined') {
        // Ambient rings animation
        gsap.to('.ambient-ring', {
            scale: 2,
            opacity: 0,
            duration: 3,
            repeat: -1,
            ease: 'power1.out',
            stagger: 1
        });
    }
});
