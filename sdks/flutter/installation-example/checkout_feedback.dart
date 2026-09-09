import 'package:flutter/material.dart';
import 'package:likerts/likerts.dart';
import 'package:likerts/survey.dart';

/// The host owns eligibility, loading, cancellation and stable submission keys.
class CheckoutFeedback extends StatefulWidget {
  final Collection collection;
  final bool eligible, submitting;
  final ValueChanged<Map<String, dynamic>> onSubmit;
  final VoidCallback onDismiss;
  const CheckoutFeedback({super.key, required this.collection, required this.eligible,
    required this.submitting, required this.onSubmit, required this.onDismiss});
  @override State<CheckoutFeedback> createState() => _CheckoutFeedbackState();
}
class _CheckoutFeedbackState extends State<CheckoutFeedback> {
  bool visible = false;
  @override Widget build(BuildContext context) {
    if (!widget.eligible) return const SizedBox.shrink();
    return Column(children: [
      TextButton(onPressed: () => setState(() => visible = true), child: const Text('Give feedback')),
      if (visible) LikertsSurvey(collection: widget.collection, disabled: widget.submitting, onSubmit: widget.onSubmit),
      if (visible) TextButton(onPressed: () {setState(() => visible = false); widget.onDismiss();}, child: const Text('Dismiss')),
    ]);
  }
}
