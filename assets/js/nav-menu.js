(function () {
    "use strict";

    const menuToggle = document.getElementById("menuToggle");
    const mainNav = document.getElementById("mainNav");

    if (!menuToggle || !mainNav) {
        return;
    }

    function setMenuState(isOpen) {
        mainNav.classList.toggle("is-open", isOpen);
        menuToggle.setAttribute("aria-expanded", String(isOpen));
    }

    menuToggle.addEventListener("click", () => {
        setMenuState(!mainNav.classList.contains("is-open"));
    });

    mainNav.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", () => {
            setMenuState(false);
        });
    });

    window.addEventListener("resize", () => {
        if (window.matchMedia("(min-width: 768px)").matches) {
            setMenuState(false);
        }
    });
})();
