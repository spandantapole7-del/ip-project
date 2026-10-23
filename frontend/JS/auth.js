// ==========================================
// HOSTEL SURVIVAL MANAGER
// AUTHENTICATION JAVASCRIPT
// ==========================================


// ------------------------------------------
// PASSWORD SHOW / HIDE
// ------------------------------------------

function togglePassword(inputId, button) {

    const input = document.getElementById(inputId);

    if (input.type === "password") {

        input.type = "text";
        button.textContent = "dYT^";

    } else {

        input.type = "password";
        button.textContent = "dY`?";

    }
}


// ------------------------------------------
// SHOW MESSAGE
// ------------------------------------------

function showMessage(message, type) {

    const messageBox = document.getElementById("authMessage");

    if (!messageBox) return;

    messageBox.textContent = message;

    messageBox.className = "auth-message " + type;
}


function setSubmitting(form, isSubmitting) {

    const button = form.querySelector('button[type="submit"]');

    if (button) {

        button.disabled = isSubmitting;

    }
}


// ------------------------------------------
// SIGNUP
// ------------------------------------------

const signupForm = document.getElementById("signupForm");

if (signupForm) {

    signupForm.addEventListener("submit", async function(event) {

        event.preventDefault();


        const name =
            document.getElementById("signupName").value.trim();

        const email =
            document.getElementById("signupEmail").value.trim().toLowerCase();

        const password =
            document.getElementById("signupPassword").value;

        const confirmPassword =
            document.getElementById("confirmPassword").value;

        const terms =
            document.getElementById("terms").checked;


        if (name.length < 2) {

            showMessage(
                "Please enter a valid name.",
                "error"
            );

            return;
        }


        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {

            showMessage(
                "Please enter a valid email address.",
                "error"
            );

            return;
        }


        if (password.length < 6) {

            showMessage(
                "Password must contain at least 6 characters.",
                "error"
            );

            return;
        }


        if (password !== confirmPassword) {

            showMessage(
                "Passwords do not match.",
                "error"
            );

            return;
        }


        if (!terms) {

            showMessage(
                "Please accept the terms to continue.",
                "error"
            );

            return;
        }


        setSubmitting(signupForm, true);


        try {

            const data = await apiRequest(
                "/auth/signup",
                {
                    method: "POST",
                    auth: false,
                    body: {
                        name: name,
                        email: email,
                        password: password
                    }
                }
            );


            saveSession(data.token, data.user);


            showMessage(
                "Account created successfully! Opening dashboard...",
                "success"
            );


            signupForm.reset();


            setTimeout(function() {

                window.location.href = "dashboard.html";

            }, 1000);

        } catch (error) {

            showMessage(error.message, "error");

            setSubmitting(signupForm, false);

        }

    });

}


// ------------------------------------------
// LOGIN
// ------------------------------------------

const loginForm = document.getElementById("loginForm");

if (loginForm) {

    loginForm.addEventListener("submit", async function(event) {

        event.preventDefault();


        const email =
            document.getElementById("loginEmail").value.trim().toLowerCase();

        const password =
            document.getElementById("loginPassword").value;


        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {

            showMessage(
                "Please enter your email and password.",
                "error"
            );

            return;
        }


        setSubmitting(loginForm, true);


        try {

            const data = await apiRequest(
                "/auth/login",
                {
                    method: "POST",
                    auth: false,
                    body: {
                        email: email,
                        password: password
                    }
                }
            );


            saveSession(data.token, data.user);


            showMessage(
                "Login successful! Opening dashboard...",
                "success"
            );


            setTimeout(function() {

                window.location.href = "dashboard.html";

            }, 800);

        } catch (error) {

            showMessage(error.message, "error");

            setSubmitting(loginForm, false);

        }

    });

}
