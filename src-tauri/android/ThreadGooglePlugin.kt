package com.kspress.thread

import android.app.Activity
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.annotation.Keep
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope

@Keep
@InvokeArg
class GoogleAuthorizationArgs {
    lateinit var scope: String
    var interactive: Boolean = false
}

@Keep
@TauriPlugin
class ThreadGooglePlugin(private val activity: Activity) : Plugin(activity) {
    private val client by lazy { Identity.getAuthorizationClient(activity) }

    @Command
    fun authorize(invoke: Invoke) {
        val args = invoke.parseArgs(GoogleAuthorizationArgs::class.java)
        if (args.scope !in setOf(
                "https://www.googleapis.com/auth/drive.file",
                "https://www.googleapis.com/auth/calendar.app.created"
            )) {
            invoke.reject("Unsupported Google permission.")
            return
        }
        val request = AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(args.scope))).build()
        client.authorize(request).addOnSuccessListener { result ->
            val pending = result.pendingIntent
            if (pending == null) {
                finish(invoke, result)
            } else if (!args.interactive) {
                invoke.reject("Reconnect Google to continue.")
            } else {
                try {
                    val resolution = IntentSenderRequest.Builder(pending.intentSender).build()
                    startIntentSenderForResult(invoke, resolution, "authorized")
                } catch (error: Exception) {
                    invoke.reject(error.localizedMessage ?: "Could not open Google authorization.")
                }
            }
        }.addOnFailureListener { error ->
            invoke.reject(error.localizedMessage ?: "Google authorization failed.")
        }
    }

    @ActivityCallback
    fun authorized(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("Google authorization was cancelled.")
            return
        }
        try {
            finish(invoke, client.getAuthorizationResultFromIntent(result.data))
        } catch (error: Exception) {
            invoke.reject(error.localizedMessage ?: "Google authorization failed.")
        }
    }

    private fun finish(invoke: Invoke, result: AuthorizationResult) {
        val scope = invoke.parseArgs(GoogleAuthorizationArgs::class.java).scope
        val token = result.accessToken
        if (token.isNullOrBlank() || scope !in result.grantedScopes.orEmpty()) {
            invoke.reject("Allow the requested Google permission to finish connecting.")
            return
        }
        invoke.resolve(JSObject().apply { put("accessToken", token) })
    }
}
