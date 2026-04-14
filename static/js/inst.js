function abrirModal(nome, cargo, descricao, urlFoto) {
    document.getElementById("modal-nome").innerText = nome;
    document.getElementById("modal-cargo").innerText = cargo;
    document.getElementById("modal-desc").innerText = descricao;
    document.getElementById("modal-foto").src = urlFoto;
    document.getElementById("modal-equipe").style.display = "flex";
}

function fecharModal() {
    document.getElementById("modal-equipe").style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
    const menuToggle = document.getElementById("menuToggle");
    const primaryMenu = document.getElementById("primaryMenu");
    const modalEquipe = document.getElementById("modal-equipe");

    document.querySelectorAll("#primaryMenu > .sobrenos_button, #primaryMenu > .button_contato, .navbar > .nav-actions").forEach((node) => {
        node.remove();
    });

    const setMenuState = (isOpen) => {
        if (!menuToggle || !primaryMenu) return;
        primaryMenu.classList.toggle("active", isOpen);
        menuToggle.setAttribute("aria-expanded", String(isOpen));
        document.body.classList.toggle("menu-open", isOpen);
    };

    menuToggle?.addEventListener("click", () => {
        const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
        setMenuState(!isOpen);
    });

    primaryMenu?.querySelectorAll(".nav-link, .btn-login, .btn-cadastro").forEach((item) => {
        item.addEventListener("click", () => {
            if (window.innerWidth <= 768) setMenuState(false);
        });
    });

    document.addEventListener("click", (event) => {
        if (!menuToggle || !primaryMenu) return;
        if (!primaryMenu.contains(event.target) && !menuToggle.contains(event.target)) {
            setMenuState(false);
        }
    });

    window.addEventListener("resize", () => {
        if (window.innerWidth > 768) setMenuState(false);
    });

    modalEquipe?.addEventListener("click", (event) => {
        if (event.target === modalEquipe) fecharModal();
    });
});
