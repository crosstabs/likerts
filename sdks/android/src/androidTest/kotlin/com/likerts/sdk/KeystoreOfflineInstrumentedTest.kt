package com.likerts.sdk

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

/** Test-only host adapter: real device Keystore + durable, backup-excluded ciphertext. */
private class DeviceQueueAdapter(context: Context, val alias: String) : OfflineSecureAdapter {
    override val protectionProfile = "android_keystore_aes_gcm"
    val file = File(context.noBackupFilesDir, "$alias.json")
    private val storage = AtomicFile(file)
    private fun key(): SecretKey = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        .getKey(alias, null) as? SecretKey ?: error("Offline key unavailable")

    fun createKey() {
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun deleteKey() { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias) }
    override suspend fun load(): List<ByteArray> {
        if (!file.exists()) return emptyList()
        val values = JSONArray(storage.readFully().decodeToString())
        return (0 until values.length()).map { Base64.decode(values.getString(it), Base64.NO_WRAP) }
    }
    override suspend fun replace(records: List<ByteArray>) {
        val values = JSONArray(records.map { Base64.encodeToString(it, Base64.NO_WRAP) })
        val stream = storage.startWrite()
        try { stream.write(values.toString().encodeToByteArray()); storage.finishWrite(stream) }
        catch (error: Throwable) { storage.failWrite(stream); throw error }
    }
    override suspend fun seal(clear: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        check(cipher.iv.size == 12)
        return cipher.iv + cipher.doFinal(clear)
    }
    override suspend fun open(sealed: ByteArray): ByteArray {
        require(sealed.size >= 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
        return cipher.doFinal(sealed.copyOfRange(12, sealed.size))
    }
    fun cleanup() { storage.delete(); deleteKey() }
}

class KeystoreOfflineInstrumentedTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun persistedCiphertextReopensRetriesAndRemovesOnlyAfterReceipt() = runBlocking {
        val adapter = DeviceQueueAdapter(context, "likerts-test-${UUID.randomUUID()}")
        adapter.createKey()
        try {
            val collection = "native-offline-collection"
            val payload = "{\"answers\":{\"private\":\"sensitive native answer\"},\"idempotencyKey\":\"native-id\"}".encodeToByteArray()
            val queue = OfflineQueue(adapter)
            val id = queue.enqueue(collection, payload, "native-id")
            assertEquals(context.noBackupFilesDir.canonicalFile, adapter.file.parentFile!!.canonicalFile)
            assertFalse(adapter.file.readText().contains(collection))
            assertFalse(adapter.file.readText().contains("sensitive native answer"))

            // New objects read the durable file and the existing Android Keystore key.
            val reopenedAdapter = DeviceQueueAdapter(context, adapter.alias)
            val reopened = OfflineQueue(reopenedAdapter)
            assertEquals(1, reopened.snapshot().pending)
            assertEquals(id, reopened.enqueue(collection, payload, "native-id"))
            val token = "ephemeral-test-credential-never-persist"
            val retry = reopened.flush(credential = { token }, send = { actualCollection, actualToken, actualPayload ->
                assertEquals(collection, actualCollection)
                assertEquals(token, actualToken)
                assertArrayEquals(payload, actualPayload)
                OfflineAttempt(503, retryAfterSeconds = 5)
            })
            assertEquals(0, retry.accepted)
            assertEquals(1, retry.status.pending)
            assertFalse(reopenedAdapter.open(reopenedAdapter.load().single()).decodeToString().contains(token))

            // A successful HTTP status without a matching accepted receipt must retain the record.
            val invalidReceipt = reopened.flush(credential = { token }, send = { _, _, _ ->
                OfflineAttempt(200, responseId = "response", receiptCollectionId = "wrong-collection", accepted = true)
            })
            assertEquals(0, invalidReceipt.accepted)
            assertEquals(1, invalidReceipt.status.pending)
            val accepted = reopened.flush(credential = { token }, send = { actualCollection, _, actualPayload ->
                assertArrayEquals(payload, actualPayload)
                OfflineAttempt(201, responseId = "response", receiptCollectionId = actualCollection, accepted = true)
            })
            assertEquals(1, accepted.accepted)
            assertEquals(0, OfflineQueue(DeviceQueueAdapter(context, adapter.alias)).snapshot().pending)
            assertTrue(reopenedAdapter.load().isEmpty())
        } finally { adapter.cleanup() }
    }

    @Test fun authenticationFailureAndMissingKeyQuarantineWithoutSending() = runBlocking {
        val adapter = DeviceQueueAdapter(context, "likerts-test-${UUID.randomUUID()}")
        adapter.createKey()
        try {
            val queue = OfflineQueue(adapter)
            queue.enqueue("collection", "{}".encodeToByteArray(), "tamper")
            val corrupted = adapter.load().single().copyOf()
            corrupted[corrupted.lastIndex] = (corrupted.last().toInt() xor 1).toByte()
            adapter.replace(listOf(corrupted))
            assertEquals(1, OfflineQueue(DeviceQueueAdapter(context, adapter.alias)).snapshot().quarantined)
            val report = queue.flush(credential = { error("Quarantined record requested a credential") },
                send = { _, _, _ -> error("Quarantined record was sent") })
            assertEquals(0, report.attempted)
            assertEquals(1, queue.purgeQuarantined())

            queue.enqueue("collection", "{}".encodeToByteArray(), "lost-key")
            adapter.deleteKey()
            val reopened = OfflineQueue(DeviceQueueAdapter(context, adapter.alias))
            assertEquals(0, reopened.snapshot().pending)
            assertEquals(1, reopened.snapshot().quarantined)
            assertEquals(1, reopened.purgeQuarantined())
            assertTrue(adapter.load().isEmpty())
        } finally { adapter.cleanup() }
    }
}
