const HSM_API_BASE = "/api";

function getAuthToken() {
    return localStorage.getItem("hostelToken");
}

async function apiRequest(path, options) {
    const settings = options || {};
    const headers = Object.assign({}, settings.headers);
    const request = {
        method: settings.method || "GET",
        headers: headers
    };

    if (settings.body !== undefined) {
        headers["Content-Type"] = "application/json";
        request.body = JSON.stringify(settings.body);
    }

    const token = getAuthToken();

    if (token && settings.auth !== false) {
        headers.Authorization = "Bearer " + token;
    }

    let response;

    try {
        response = await fetch(HSM_API_BASE + path, request);
    } catch (error) {
        const networkError = new Error(
            "Cannot reach the backend. Start it with npm start in the backend folder."
        );
        networkError.cause = error;
        throw networkError;
    }

    let data = null;

    if (response.status !== 204) {
        const text = await response.text();

        if (text) {
            try {
                data = JSON.parse(text);
            } catch (error) {
                data = { message: text };
            }
        }
    }

    if (!response.ok) {
        const requestError = new Error(
            (data && data.message) || "Request failed."
        );
        requestError.status = response.status;
        throw requestError;
    }

    return data;
}

function saveSession(token, user) {
    localStorage.setItem("hostelToken", token);
    localStorage.setItem("currentUser", JSON.stringify(user));
    localStorage.setItem("isLoggedIn", "true");
    localStorage.removeItem("hostelUser");
}

function clearSession() {
    localStorage.removeItem("hostelToken");
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("currentUser");
    localStorage.removeItem("hostelUser");
}

async function apiLogout() {
    try {
        await apiRequest("/auth/logout", { method: "POST" });
    } catch (error) {
        console.error("Logout request failed:", error.message);
    }

    clearSession();
}

function bindLogoutButtons() {
    ["logoutButton", "logoutBtn"].forEach(function (id) {
        const button = document.getElementById(id);

        if (button) {
            button.addEventListener("click", clearSession);
        }
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindLogoutButtons);
} else {
    bindLogoutButtons();
}
